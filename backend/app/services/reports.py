"""Report building: live monthly report + trends + helpers shared with weekly payloads."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.timeutils import (
    get_tz,
    jalali_month_label,
    jalali_month_range,
    to_utc,
)
from app.models import Sprint, SprintMembership, Task, TaskStatus, TimeEntry, User
from app.services.sprints import LocationResolver


def build_trend_payload(db: Session, user: User, weeks: int = 8) -> dict:
    """Live per-week totals for the last `weeks` sprints: total/billable logged,
    per-area split, and the sum of member estimates — the raw material for the
    trend charts and the estimate-accuracy verdict."""
    resolve = LocationResolver(db)
    sprints = db.scalars(
        select(Sprint)
        .where(Sprint.user_id == user.id)
        .order_by(Sprint.start_at.desc())
        .limit(max(1, min(weeks, 26)))
    ).all()
    sprints.reverse()
    if not sprints:
        return {"weeks": []}

    window_start = sprints[0].start_at
    window_end = max(s.end_at for s in sprints)

    members_by_sprint = {
        s.id: set(
            db.scalars(select(SprintMembership.task_id).where(SprintMembership.sprint_id == s.id)).all()
        )
        for s in sprints
    }

    entry_rows = (
        db.query(TimeEntry, Task)
        .join(Task, Task.id == TimeEntry.task_id)
        .filter(TimeEntry.user_id == user.id, TimeEntry.start_at >= window_start, TimeEntry.start_at < window_end)
        .all()
    )

    weeks_data = {
        s.id: {"sprint": s, "total": 0, "billable": 0, "areas": {}}
        for s in sprints
    }
    for e, task in entry_rows:
        for s in sprints:
            if s.start_at <= e.start_at < s.end_at and e.task_id in members_by_sprint[s.id]:
                wd = weeks_data[s.id]
                wd["total"] += e.minutes
                if e.billable:
                    wd["billable"] += e.minutes
                area_id, name, color, _p, _pn = resolve(task)
                key = area_id if area_id else "__standalone__"
                bucket = wd["areas"].setdefault(
                    key, {"area_id": area_id, "name": name, "color": color, "minutes": 0}
                )
                bucket["minutes"] += e.minutes
                break

    out_weeks = []
    for s in sprints:
        wd = weeks_data[s.id]
        est = (
            db.query(func.sum(Task.estimate_minutes))
            .join(SprintMembership, SprintMembership.task_id == Task.id)
            .filter(SprintMembership.sprint_id == s.id)
            .scalar()
        )
        out_weeks.append(
            {
                "sprint_id": s.id,
                "name": s.name,
                "start_at": s.start_at,
                "end_at": s.end_at,
                "status": s.status,
                "total_minutes": wd["total"],
                "billable_minutes": wd["billable"],
                "estimate_minutes": int(est or 0),
                "areas": sorted(wd["areas"].values(), key=lambda a: -a["minutes"]),
            }
        )

    return {"weeks": out_weeks}


def build_monthly_payload(db: Session, user: User, jy: int, jm: int) -> dict:
    resolve = LocationResolver(db)
    start, end = jalali_month_range(jy, jm, user.timezone)

    entry_rows = (
        db.query(TimeEntry, Task)
        .join(Task, Task.id == TimeEntry.task_id)
        .filter(TimeEntry.user_id == user.id, TimeEntry.start_at >= start, TimeEntry.start_at < end)
        .all()
    )

    areas: dict = {}
    tasks_agg: dict = {}
    logged_by_project: dict = {}

    def area_bucket(area_id, name, color):
        key = area_id if area_id else "__standalone__"
        if key not in areas:
            areas[key] = {
                "area_id": area_id,
                "name": name,
                "color": color,
                "minutes": 0,
                "billable_minutes": 0,
                "area_level_minutes": 0,
                "projects": {},
            }
        return areas[key]

    for e, task in entry_rows:
        area_id, area_name, area_color, project_id, project_name = resolve(task)
        a = area_bucket(area_id, area_name, area_color)
        a["minutes"] += e.minutes
        a["billable_minutes"] += e.minutes if e.billable else 0
        if project_id is not None:
            if project_id not in a["projects"]:
                a["projects"][project_id] = {
                    "project_id": project_id,
                    "name": project_name,
                    "minutes": 0,
                    "billable_minutes": 0,
                }
            p = a["projects"][project_id]
            p["minutes"] += e.minutes
            p["billable_minutes"] += e.minutes if e.billable else 0
            logged_by_project.setdefault(project_id, {"name": project_name, "minutes": 0})
            logged_by_project[project_id]["minutes"] += e.minutes
        elif area_id is not None:
            a["area_level_minutes"] += e.minutes

        t = tasks_agg.setdefault(
            task.id,
            {
                "task_id": task.id,
                "title": task.title,
                "area_name": area_name,
                "project_name": project_name,
                "minutes": 0,
                "billable_minutes": 0,
                "estimate_minutes": task.estimate_minutes,
            },
        )
        t["minutes"] += e.minutes
        t["billable_minutes"] += e.minutes if e.billable else 0

    area_list = []
    for a in areas.values():
        a["projects"] = sorted(a["projects"].values(), key=lambda x: -x["minutes"])
        area_list.append(a)
    area_list.sort(key=lambda x: -x["minutes"])

    # Completed in this month: tasks with closed_at inside the month range.
    closed_tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user.id,
            Task.status == TaskStatus.closed.value,
            Task.closed_at >= start,
            Task.closed_at < end,
        )
        .all()
    )
    completed = []
    for t in closed_tasks:
        area_id, area_name, _c, _p, project_name = resolve(t)
        completed.append(
            {"task_id": t.id, "title": t.title, "area_name": area_name, "project_name": project_name, "closed_at": t.closed_at}
        )
    completed.sort(key=lambda x: x["closed_at"])

    # Estimate vs actual for tasks that actually got time this month.
    est_by_project: dict = {}
    for t in tasks_agg.values():
        task = db.get(Task, t["task_id"])
        area_id, _an, _ac, project_id, project_name = resolve(task)
        if project_id is None or task.estimate_minutes is None:
            continue
        bucket = est_by_project.setdefault(
            project_id,
            {"project_id": project_id, "name": project_name, "estimate_minutes": 0, "logged_minutes": 0},
        )
        bucket["estimate_minutes"] += task.estimate_minutes
        bucket["logged_minutes"] = logged_by_project.get(project_id, {}).get("minutes", 0)

    # Week strip: sprints overlapping the month with logged minutes (membership rule).
    overlapping = (
        db.query(Sprint)
        .filter(Sprint.user_id == user.id, Sprint.start_at < end, Sprint.end_at > start)
        .order_by(Sprint.start_at)
        .all()
    )
    weeks = []
    for sprint in overlapping:
        seg_start = max(sprint.start_at, start)
        seg_end = min(sprint.end_at, end)
        minutes = (
            db.query(TimeEntry)
            .join(Task, Task.id == TimeEntry.task_id)
            .join(SprintMembership, SprintMembership.task_id == Task.id)
            .filter(
                SprintMembership.sprint_id == sprint.id,
                TimeEntry.start_at >= seg_start,
                TimeEntry.start_at < seg_end,
                TimeEntry.user_id == user.id,
            )
            .with_entities(TimeEntry.minutes)
            .all()
        )
        week_minutes = sum(m for (m,) in minutes)
        weeks.append(
            {
                "sprint_id": sprint.id,
                "name": sprint.name,
                "status": sprint.status,
                "minutes": week_minutes,
                "full_overlap": sprint.start_at >= start and sprint.end_at <= end,
            }
        )

    return {
        "kind": "monthly",
        "jy": jy,
        "jm": jm,
        "month_label": jalali_month_label(jy, jm),
        "start_at": start,
        "end_at": end,
        "total_minutes": sum(t["minutes"] for t in tasks_agg.values()),
        "billable_minutes": sum(t["billable_minutes"] for t in tasks_agg.values()),
        "completed_count": len(completed),
        "areas": area_list,
        "tasks": sorted(tasks_agg.values(), key=lambda x: -x["minutes"]),
        "completed": completed,
        "estimate": {
            "projects": sorted(est_by_project.values(), key=lambda x: -x["logged_minutes"]),
            "total_estimate_minutes": sum(p["estimate_minutes"] for p in est_by_project.values()),
            "total_logged_minutes": sum(p["logged_minutes"] for p in est_by_project.values()),
        },
        "weeks": weeks,
    }
