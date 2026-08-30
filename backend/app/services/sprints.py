import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.serialize import jsonable
from app.core.timeutils import get_tz, sprint_label, to_utc, week_start_utc
from app.models import (
    Area,
    MembershipSource,
    Project,
    Sprint,
    SprintMembership,
    SprintStatus,
    Task,
    TaskStatus,
    TimeEntry,
    User,
    WeeklyReport,
    utcnow,
)
from app.services.builders import _task_core_select, build_task_outs
from app.services.recurrence import create_next_occurrence, task_has_recurrence


class LocationResolver:
    """Resolves (area_id, area_name, area_color, project_id, project_name) with caching.

    Standalone tasks map to a virtual area «بدون حوزه».
    """

    def __init__(self, db: Session):
        self.db = db
        self._areas: dict = {}
        self._projects: dict = {}

    def _area(self, area_id):
        if area_id not in self._areas:
            a = self.db.get(Area, area_id)
            self._areas[area_id] = (a.name, a.color) if a else (None, None)
        return self._areas[area_id]

    def _project(self, project_id):
        if project_id not in self._projects:
            p = self.db.get(Project, project_id)
            self._projects[project_id] = p
        return self._projects[project_id]

    def __call__(self, task: Task):
        if task.project_id is not None:
            project = self._project(task.project_id)
            if project is None:
                return (None, None, None, None, None)
            area_name, area_color = self._area(project.area_id)
            return (project.area_id, area_name, area_color, project.id, project.name)
        if task.area_id is not None:
            area_name, area_color = self._area(task.area_id)
            return (task.area_id, area_name, area_color, None, None)
        return (None, "بدون حوزه", "#94a3b8", None, None)


def ensure_sprint(db: Session, user: User, at: datetime) -> Sprint:
    """Get-or-create the weekly sprint containing `at` (Sat 00:00 → Fri 24:00, user TZ).
    Newly created sprints get the user's active recurring tasks auto-injected."""
    start = week_start_utc(at, user.timezone)
    sprint = db.scalar(select(Sprint).where(Sprint.user_id == user.id, Sprint.start_at == start))
    if sprint is not None:
        return sprint
    end = start + timedelta(days=7)
    sprint = Sprint(user_id=user.id, name=sprint_label(start, user.timezone), start_at=start, end_at=end)
    db.add(sprint)
    db.flush()
    _inject_recurring_tasks(db, user, sprint)
    db.commit()
    db.refresh(sprint)
    return sprint


def _inject_recurring_tasks(db: Session, user: User, sprint: Sprint) -> None:
    """Auto-add the user's active recurring tasks (backlog/open, not already
    members) to a newly created sprint — routine work plans itself."""
    tasks = db.scalars(
        select(Task).where(
            Task.user_id == user.id,
            task_has_recurrence(Task),
            Task.status.in_([TaskStatus.backlog.value, TaskStatus.open.value]),
            Task.id.notin_(
                select(SprintMembership.task_id).where(SprintMembership.sprint_id == sprint.id)
            ),
        )
    ).all()
    for t in tasks:
        db.add(SprintMembership(sprint_id=sprint.id, task_id=t.id, source=MembershipSource.manual.value))
        if t.status == TaskStatus.backlog.value:
            t.status = TaskStatus.open.value


def current_sprint(db: Session, user: User) -> Sprint:
    return ensure_sprint(db, user, datetime.now(timezone.utc))


def add_tasks_to_sprint(db: Session, user: User, sprint: Sprint, items) -> None:
    for item in items:
        task = db.get(Task, item.task_id)
        if task is None or task.user_id != user.id:
            raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
        if item.estimate_minutes is not None:
            task.estimate_minutes = item.estimate_minutes
        existing = db.scalar(
            select(SprintMembership).where(
                SprintMembership.sprint_id == sprint.id, SprintMembership.task_id == task.id
            )
        )
        if existing is None:
            db.add(
                SprintMembership(sprint_id=sprint.id, task_id=task.id, source=MembershipSource.manual.value)
            )
        if task.status == TaskStatus.backlog.value:
            task.status = TaskStatus.open.value
    db.commit()


def remove_task_from_sprint(db: Session, user: User, sprint: Sprint, task_id: uuid.UUID) -> None:
    m = db.scalar(
        select(SprintMembership).where(
            SprintMembership.sprint_id == sprint.id, SprintMembership.task_id == task_id
        )
    )
    if m is None:
        raise HTTPException(status_code=404, detail="این تسک در این اسپرینت عضو نیست.")
    task = db.get(Task, task_id)
    db.delete(m)
    if task is not None and task.status == TaskStatus.open.value:
        task.status = TaskStatus.backlog.value
    db.commit()


def close_sprint(db: Session, user: User, sprint: Sprint, decisions) -> dict:
    if sprint.status == SprintStatus.closed.value:
        raise HTTPException(status_code=409, detail="این اسپرینت بسته شده است.")
    decision_map = {d.task_id: d.action for d in decisions}
    next_sprint: Sprint | None = None
    now = utcnow()

    memberships = db.scalars(
        select(SprintMembership).where(SprintMembership.sprint_id == sprint.id)
    ).all()
    for m in memberships:
        task = db.get(Task, m.task_id)
        if task is None or task.status == TaskStatus.closed.value:
            continue
        action = decision_map.get(task.id, "carry_over")
        if action == "carry_over":
            if next_sprint is None:
                next_sprint = ensure_sprint(db, user, sprint.end_at + timedelta(minutes=1))
            existing = db.scalar(
                select(SprintMembership).where(
                    SprintMembership.sprint_id == next_sprint.id, SprintMembership.task_id == task.id
                )
            )
            if existing is None:
                db.add(
                    SprintMembership(
                        sprint_id=next_sprint.id,
                        task_id=task.id,
                        source=MembershipSource.carry_over.value,
                    )
                )
            # Status unchanged (Open stays Open, In Progress stays In Progress).
        elif action == "backlog":
            db.delete(m)
            task.status = TaskStatus.backlog.value
            task.closed_at = None
        elif action == "close":
            task.status = TaskStatus.closed.value
            task.closed_at = now
            create_next_occurrence(db, user, task)

    sprint.status = SprintStatus.closed.value
    sprint.closed_at = now
    db.flush()

    if sprint.report is not None:
        db.delete(sprint.report)
        db.flush()
    payload = jsonable(build_weekly_payload(db, user, sprint))
    db.add(WeeklyReport(sprint_id=sprint.id, payload=payload))
    db.commit()
    return payload


def reopen_sprint(db: Session, user: User, sprint: Sprint) -> None:
    if sprint.status != SprintStatus.closed.value:
        raise HTTPException(status_code=409, detail="این اسپرینت باز است.")
    nxt = db.scalar(select(Sprint).where(Sprint.user_id == user.id, Sprint.start_at == sprint.end_at))
    if nxt is not None and nxt.status == SprintStatus.closed.value:
        raise HTTPException(status_code=409, detail="اسپرینت بعدی بسته شده است؛ امکان بازگشایی نیست.")
    sprint.status = SprintStatus.active.value
    sprint.closed_at = None
    if sprint.report is not None:
        db.delete(sprint.report)
    db.commit()


def sprint_members_with_tasks(db: Session, sprint: Sprint):
    rows = (
        db.query(SprintMembership, Task)
        .join(Task, Task.id == SprintMembership.task_id)
        .filter(SprintMembership.sprint_id == sprint.id)
        .all()
    )
    if not rows:
        return []
    proper = db.execute(
        _task_core_select().where(Task.id.in_([t.id for _, t in rows]))
    ).all()
    outs = {o["id"]: o for o in build_task_outs(db, proper)}
    return [(m, outs[t.id]) for m, t in rows]


def build_weekly_payload(db: Session, user: User, sprint: Sprint) -> dict:
    resolve = LocationResolver(db)
    entry_rows = (
        db.query(TimeEntry, Task)
        .join(Task, Task.id == TimeEntry.task_id)
        .join(SprintMembership, SprintMembership.task_id == Task.id)
        .filter(
            SprintMembership.sprint_id == sprint.id,
            TimeEntry.start_at >= sprint.start_at,
            TimeEntry.start_at < sprint.end_at,
            TimeEntry.user_id == user.id,
        )
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
        minutes, billable = e.minutes, e.billable

        a = area_bucket(area_id, area_name, area_color)
        a["minutes"] += minutes
        a["billable_minutes"] += minutes if billable else 0
        if project_id is not None:
            if project_id not in a["projects"]:
                a["projects"][project_id] = {
                    "project_id": project_id,
                    "name": project_name,
                    "minutes": 0,
                    "billable_minutes": 0,
                }
            p = a["projects"][project_id]
            p["minutes"] += minutes
            p["billable_minutes"] += minutes if billable else 0
            logged_by_project.setdefault(project_id, {"name": project_name, "minutes": 0})
            logged_by_project[project_id]["minutes"] += minutes
        elif area_id is not None:
            a["area_level_minutes"] += minutes

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
        t["minutes"] += minutes
        t["billable_minutes"] += minutes if billable else 0

    area_list = []
    for a in areas.values():
        a["projects"] = sorted(a["projects"].values(), key=lambda x: -x["minutes"])
        area_list.append(a)
    area_list.sort(key=lambda x: -x["minutes"])

    member_tasks = db.scalars(
        select(Task)
        .join(SprintMembership, SprintMembership.task_id == Task.id)
        .where(SprintMembership.sprint_id == sprint.id)
    ).all()

    completed = []
    for t in member_tasks:
        if t.status != TaskStatus.closed.value:
            continue
        if t.closed_at is not None and t.closed_at < sprint.start_at:
            continue
        area_id, area_name, _c, _p, project_name = resolve(t)
        completed.append(
            {"task_id": t.id, "title": t.title, "area_name": area_name, "project_name": project_name, "closed_at": t.closed_at}
        )
    completed.sort(key=lambda x: x["closed_at"] or utcnow())

    # Estimate vs actual, per project with any logged time this week.
    est_by_project: dict = {}
    for t in member_tasks:
        area_id, _an, _ac, project_id, project_name = resolve(t)
        if project_id is None:
            continue
        bucket = est_by_project.setdefault(
            project_id, {"project_id": project_id, "name": project_name, "estimate_minutes": 0, "logged_minutes": 0}
        )
        bucket["estimate_minutes"] += t.estimate_minutes or 0
        if project_id in logged_by_project:
            bucket["logged_minutes"] = logged_by_project[project_id]["minutes"]

    return {
        "kind": "weekly",
        "sprint_id": sprint.id,
        "sprint_name": sprint.name,
        "start_at": sprint.start_at,
        "end_at": sprint.end_at,
        "total_minutes": sum(t["minutes"] for t in tasks_agg.values()),
        "billable_minutes": sum(t["billable_minutes"] for t in tasks_agg.values()),
        "areas": area_list,
        "tasks": sorted(tasks_agg.values(), key=lambda x: -x["minutes"]),
        "completed": completed,
        "estimate": {
            "projects": sorted(est_by_project.values(), key=lambda x: -x["logged_minutes"]),
            "total_estimate_minutes": sum(p["estimate_minutes"] for p in est_by_project.values()),
            "total_logged_minutes": sum(p["logged_minutes"] for p in est_by_project.values()),
        },
    }


# ---------------- planning assistant (read-only suggestions) ----------------

_REASON_RANK = {"overdue": 0, "due_this_week": 1, "logged_last_week": 2, "recurring": 3}


def planning_suggestions(db: Session, user: User, sprint: Sprint) -> list[dict]:
    """Suggest non-member tasks worth planning this week. Read-only: it never
    mutates anything — the UI confirms through the normal add-tasks endpoint.

    Reasons:
      overdue          — due date already passed
      due_this_week    — due on/before this sprint's Friday
      logged_last_week — time was logged on it during the previous sprint
      recurring        — task has a recurrence rule
    """
    if sprint.status != SprintStatus.active.value:
        return []

    member_ids = set(
        db.scalars(select(SprintMembership.task_id).where(SprintMembership.sprint_id == sprint.id)).all()
    )
    base_conds = [Task.user_id == user.id, Task.status != TaskStatus.closed.value]
    if member_ids:
        base_conds.append(Task.id.notin_(member_ids))
    rows = db.execute(_task_core_select().where(*base_conds)).all()
    candidates = build_task_outs(db, rows)
    if not candidates:
        return []

    prev_start = sprint.start_at - timedelta(days=7)
    prev_logged = set(
        db.scalars(
            select(TimeEntry.task_id).where(
                TimeEntry.user_id == user.id,
                TimeEntry.start_at >= prev_start,
                TimeEntry.start_at < sprint.start_at,
            )
        ).all()
    )
    recurring = set(
        db.scalars(
            select(Task.id).where(
                Task.user_id == user.id, task_has_recurrence(Task)
            )
        ).all()
    )
    tz = get_tz(user.timezone)
    today = to_utc(datetime.now(timezone.utc)).astimezone(tz).date()
    friday = to_utc(sprint.end_at - timedelta(minutes=1)).astimezone(tz).date()

    out = []
    for t in candidates:
        reasons = []
        if t["due_date"] is not None:
            if t["due_date"] < today:
                reasons.append("overdue")
            elif t["due_date"] <= friday:
                reasons.append("due_this_week")
        if t["id"] in prev_logged:
            reasons.append("logged_last_week")
        if t["id"] in recurring:
            reasons.append("recurring")
        if reasons:
            out.append({"task": t, "reasons": reasons})

    out.sort(key=lambda s: (min(_REASON_RANK[r] for r in s["reasons"]), -s["task"]["logged_minutes"]))
    return out
