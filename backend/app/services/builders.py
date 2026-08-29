"""Builders that assemble API output rows (TaskOut etc.) with aggregate fields."""

import uuid

from sqlalchemy import String, case, func, select
from sqlalchemy.orm import Session

from app.models import Area, Project, Sprint, SprintMembership, Subtask, Tag, Task, TaskTag, TimeEntry


def _task_core_select():
    area = Area.__table__.alias("a_own")
    project = Project.__table__.alias("p_own")
    parea = Area.__table__.alias("a_via_project")

    logged = (
        select(func.coalesce(func.sum(TimeEntry.minutes), 0))
        .where(TimeEntry.task_id == Task.id)
        .correlate(Task)
        .scalar_subquery()
    )
    active_sprint = (
        select(SprintMembership.sprint_id)
        .join(Sprint, Sprint.id == SprintMembership.sprint_id)
        .where(SprintMembership.task_id == Task.id, Sprint.status == "active")
        .order_by(Sprint.start_at.desc())
        .limit(1)
        .correlate(Task)
        .scalar_subquery()
    )
    return (
        select(
            Task,
            logged.label("logged_minutes"),
            active_sprint.label("active_sprint_id"),
            func.coalesce(area.c.name, parea.c.name).label("area_name"),
            func.coalesce(area.c.color, parea.c.color).label("area_color"),
            func.coalesce(area.c.billable_default, parea.c.billable_default).label("area_billable_default"),
            project.c.name.label("project_name"),
        )
        .outerjoin(area, area.c.id == Task.area_id)
        .outerjoin(project, project.c.id == Task.project_id)
        .outerjoin(parea, parea.c.id == project.c.area_id)
    )


def _attach_tags_and_subtasks(db: Session, task_ids: list[uuid.UUID], items: list[dict]) -> None:
    if not task_ids:
        for it in items:
            it["tags"] = []
        return
    tag_rows = (
        db.query(TaskTag.task_id, Tag.id, Tag.name)
        .join(Tag, Tag.id == TaskTag.tag_id)
        .filter(TaskTag.task_id.in_(task_ids))
        .all()
    )
    tags_by_task: dict[uuid.UUID, list[dict]] = {}
    for task_id, tid, name in tag_rows:
        tags_by_task.setdefault(task_id, []).append({"id": tid, "name": name})

    sub_rows = (
        db.query(
            Subtask.task_id,
            func.count().label("total"),
            func.sum(case((Subtask.done.is_(True), 1), else_=0)).label("done"),
        )
        .filter(Subtask.task_id.in_(task_ids))
        .group_by(Subtask.task_id)
        .all()
    )
    subs_by_task = {r.task_id: (r.total, int(r.done or 0)) for r in sub_rows}

    for it in items:
        it["tags"] = tags_by_task.get(it["id"], [])
        total, done = subs_by_task.get(it["id"], (0, 0))
        it["subtask_total"] = total
        it["subtask_done"] = done


def build_task_outs(db: Session, rows) -> list[dict]:
    items = []
    for task, logged, active_sprint_id, area_name, area_color, area_billable, project_name in rows:
        items.append(
            {
                "id": task.id,
                "title": task.title,
                "status": task.status,
                "priority": task.priority,
                "estimate_minutes": task.estimate_minutes,
                "logged_minutes": int(logged or 0),
                "due_date": task.due_date,
                "issue_key": task.issue_key,
                "area_id": task.area_id,
                "project_id": task.project_id,
                "area_name": area_name,
                "area_color": area_color,
                "area_billable_default": bool(area_billable) if area_billable is not None else None,
                "project_name": project_name,
                "active_sprint_id": active_sprint_id,
                "sort_order": task.sort_order,
                "updated_at": task.updated_at,
            }
        )
    _attach_tags_and_subtasks(db, [it["id"] for it in items], items)
    return items


def build_task_detail(db: Session, task: Task) -> dict:
    row = db.execute(_task_core_select().where(Task.id == task.id)).first()
    if row is None:
        item = {
            "id": task.id, "title": task.title, "status": task.status, "priority": task.priority,
            "estimate_minutes": task.estimate_minutes, "logged_minutes": 0, "due_date": task.due_date,
            "issue_key": task.issue_key,
            "area_id": task.area_id, "project_id": task.project_id, "area_name": None,
            "area_color": None, "area_billable_default": None, "project_name": None, "active_sprint_id": None,
            "sort_order": task.sort_order, "updated_at": task.updated_at,
        }
    else:
        items = build_task_outs(db, [row])
        item = items[0]
        item["logged_minutes"] = int(row[1] or 0)

    item.update(
        {
            "description": task.description,
            "notes": task.notes,
            "recurrence_rule": task.recurrence_rule,
            "created_at": task.created_at,
            "closed_at": task.closed_at,
            "subtasks": [
                {"id": s.id, "title": s.title, "done": s.done, "sort_order": s.sort_order}
                for s in task.subtasks
            ],
        }
    )

    memberships = (
        db.query(SprintMembership, Sprint)
        .join(Sprint, Sprint.id == SprintMembership.sprint_id)
        .filter(SprintMembership.task_id == task.id)
        .order_by(Sprint.start_at.desc())
        .all()
    )
    item["memberships"] = [
        {"sprint_id": s.id, "sprint_name": s.name, "source": m.source} for m, s in memberships
    ]

    entries = (
        db.query(TimeEntry)
        .filter(TimeEntry.task_id == task.id)
        .order_by(TimeEntry.start_at.desc())
        .limit(200)
        .all()
    )
    item["entries"] = [
        {
            "id": e.id,
            "task_id": e.task_id,
            "task_title": task.title,
            "area_color": item.get("area_color"),
            "start_at": e.start_at,
            "end_at": e.end_at,
            "minutes": e.minutes,
            "note": e.note,
            "billable": e.billable,
        }
        for e in entries
    ]
    return item


def entry_out(e: TimeEntry, task_title: str = "", area_color: str | None = None) -> dict:
    return {
        "id": e.id,
        "task_id": e.task_id,
        "task_title": task_title,
        "area_color": area_color,
        "start_at": e.start_at,
        "end_at": e.end_at,
        "minutes": e.minutes,
        "note": e.note,
        "billable": e.billable,
    }


def entries_for_range(db: Session, user_id, start, end) -> list[dict]:
    q = (
        db.query(TimeEntry, Task, Project, Area)
        .join(Task, Task.id == TimeEntry.task_id)
        .outerjoin(Project, Project.id == Task.project_id)
        .outerjoin(Area, Area.id == Task.area_id)
        .filter(
            TimeEntry.user_id == user_id,
            TimeEntry.start_at < end,
            TimeEntry.end_at > start,
        )
        .order_by(TimeEntry.start_at)
    )
    out = []
    for e, task, project, area in q.all():
        out.append(entry_out(e, task_title=task.title, area_color=(area.color if area else (project.area.color if project else None))))
    return out
