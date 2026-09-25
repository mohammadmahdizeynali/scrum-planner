import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import (
    Area,
    Project,
    Sprint,
    SprintMembership,
    Subtask,
    Tag,
    Task,
    TaskDependency,
    TaskPriority,
    TaskStatus,
    TaskTag,
    TaskType,
    TimeEntry,
    User,
    utcnow,
)
from app.schemas import (
    DependencyAddIn,
    DeletePreviewOut,
    SubtaskIn,
    SubtaskOut,
    SubtaskUpdateIn,
    TagIn,
    TagOut,
    TaskCreateIn,
    TaskDetail,
    TaskOut,
    TaskUpdateIn,
)
from app.services.builders import build_task_detail, build_task_outs, _task_core_select
from app.services.issue_keys import effective_key_holder, next_key
from app.services.recurrence import create_next_occurrence

router = APIRouter(tags=["tasks"])


def _validate_parents(db: Session, user: User, area_id, project_id):
    """Validate placement rule: project XOR area, both owned. Returns (area_id, project_id)."""
    if project_id is not None:
        project = db.get(Project, project_id)
        if project is None or project.user_id != user.id:
            raise HTTPException(status_code=404, detail="پروژه پیدا نشد.")
        return (None, project_id)
    if area_id is not None:
        area = db.get(Area, area_id)
        if area is None or area.user_id != user.id:
            raise HTTPException(status_code=404, detail="مسیر پیدا نشد.")
        return (area_id, None)
    return (None, None)


def _default_task_type(db: Session, area: Area | None, project: Project | None) -> str:
    """Explicit choice > project (or its parent) > area > timed."""
    p = project
    while p is not None:
        if p.default_task_type:
            return p.default_task_type
        p = db.get(Project, p.parent_project_id) if p.parent_project_id else None
    if area is not None and area.default_task_type:
        return area.default_task_type
    return TaskType.timed.value


def _set_tags(db: Session, user: User, task: Task, tag_ids: list[uuid.UUID]) -> None:
    task.tag_links.clear()
    for tid in dict.fromkeys(tag_ids):  # dedupe, keep order
        tag = db.get(Tag, tid)
        if tag is None or tag.user_id != user.id:
            raise HTTPException(status_code=404, detail="برچسب پیدا نشد.")
        task.tag_links.append(TaskTag(task_id=task.id, tag_id=tid))


@router.get("/tasks")
def list_tasks(
    area_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    status: str | None = Query(default=None, pattern="^(backlog|open|in_progress|closed)$"),
    task_type: str | None = Query(default=None, pattern="^(todo|timed)$"),
    priority: str | None = Query(default=None, pattern="^(high|medium|low)$"),
    tag_id: uuid.UUID | None = None,
    q: str | None = None,
    standalone: bool = False,
    archived: bool = False,
    sprint_id: uuid.UUID | None = None,
    due_within_days: int | None = None,
    limit: int = Query(default=200, le=500),
    offset: int = 0,
    sort: str = Query(default="updated", pattern="^(updated|manual|due)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conds = [Task.user_id == user.id]
    if archived:
        conds.append(Task.archived_at.isnot(None))
    elif q:
        # Explicit search reaches into the archive too — closed tasks are
        # auto-archived, and a deliberate lookup should still find them.
        pass
    else:
        conds.append(Task.archived_at.is_(None))
    if area_id is not None:
        conds.append(Task.area_id == area_id)
    if project_id is not None:
        conds.append(Task.project_id == project_id)
    if status:
        conds.append(Task.status == status)
    if task_type:
        conds.append(Task.task_type == task_type)
    if priority:
        conds.append(Task.priority == priority)
    if standalone:
        conds.append(Task.area_id.is_(None))
        conds.append(Task.project_id.is_(None))
    if due_within_days is not None:
        from datetime import date, timedelta

        today = utcnow().date()
        conds.append(Task.due_date.isnot(None))
        conds.append(Task.due_date <= today + timedelta(days=due_within_days))
    if tag_id is not None:
        conds.append(Task.id.in_(select(TaskTag.task_id).where(TaskTag.tag_id == tag_id)))
    if q:
        like = f"%{q.strip()}%"
        text_conds = [or_(Task.title.ilike(like), Task.description.ilike(like), Task.notes.ilike(like), Task.issue_key.ilike(like))]
        # "sbu-2" / "SBU 2" → exact padded key "SBU-002"
        key_m = re.match(r"^([a-zA-Z]{2,10})[-/ _]?(\d{1,6})$", q.strip())
        if key_m:
            text_conds.append(Task.issue_key == f"{key_m.group(1).upper()}-{int(key_m.group(2)):03d}")
        conds.append(or_(*text_conds))
    if sprint_id is not None:
        conds.append(Task.id.in_(select(SprintMembership.task_id).where(SprintMembership.sprint_id == sprint_id)))

    base = _task_core_select().where(*conds)
    if sort == "manual":
        base = base.order_by(Task.sort_order, Task.created_at)
    elif sort == "due":
        base = base.order_by(Task.due_date.is_(None), Task.due_date, Task.sort_order)
    else:
        base = base.order_by(Task.updated_at.desc())

    total = db.query(func.count()).select_from(Task).where(*conds).scalar()
    rows = db.execute(base.limit(limit).offset(offset)).all()
    return {"items": build_task_outs(db, rows), "total": int(total or 0)}


@router.post("/tasks", response_model=TaskOut)
def create_task(body: TaskCreateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    area_id, project_id = _validate_parents(db, user, body.area_id, body.project_id)
    area = None
    project = None
    if project_id is not None:
        project = db.get(Project, project_id)
        area = db.get(Area, project.area_id)
    elif area_id is not None:
        area = db.get(Area, area_id)
    # Key prefix chain: direct project → parent project → area.
    holder = effective_key_holder(db, project)
    if holder is None and area is not None and area.key_prefix:
        holder = area
    issue_key = next_key(db, holder) if holder is not None else None
    task = Task(
        user_id=user.id,
        title=body.title.strip(),
        description=body.description,
        notes=body.notes,
        estimate_minutes=body.estimate_minutes,
        priority=TaskPriority(body.priority).value,
        status=TaskStatus.backlog.value,
        task_type=body.task_type or _default_task_type(db, area, project),
        area_id=area_id,
        project_id=project_id,
        due_date=body.due_date,
        due_time=body.due_time,
        recurrence_rule=body.recurrence_rule,
        issue_key=issue_key,
    )
    db.add(task)
    db.flush()
    if body.tag_ids:
        _set_tags(db, user, task, body.tag_ids)
    for i, st in enumerate(body.subtasks):
        db.add(Subtask(task_id=task.id, title=st.title, sort_order=i))
    db.commit()
    db.refresh(task)
    detail = build_task_detail(db, task)
    return TaskOut(**{k: v for k, v in detail.items() if k in TaskOut.model_fields})


def _retention_cutoff_utc(user: User):
    from app.core.timeutils import jalali_month_start_utc_months_ago

    return jalali_month_start_utc_months_ago(utcnow(), 3, user.timezone)


@router.get("/tasks/retention")
def retention_candidates(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Tasks closed before the start of (current Jalali month − 3) — nominated for
    permanent deletion. Nothing is deleted without explicit confirmation."""
    cutoff = _retention_cutoff_utc(user)
    tasks = db.scalars(
        select(Task).where(
            Task.user_id == user.id,
            Task.status == TaskStatus.closed.value,
            Task.closed_at.isnot(None),
            Task.closed_at < cutoff,
        )
    ).all()
    out = []
    for t in tasks:
        logged = db.query(func.coalesce(func.sum(TimeEntry.minutes), 0)).filter(TimeEntry.task_id == t.id).scalar()
        from app.core.timeutils import format_jalali_date, jalali_parts, jalali_month_label

        closed_local = t.closed_at
        month_label = None
        if closed_local is not None:
            from app.core.timeutils import get_tz

            d = closed_local.astimezone(get_tz(user.timezone)).date()
            jy, jm, _ = jalali_parts(d)
            month_label = jalali_month_label(jy, jm)
        out.append(
            {
                "id": t.id,
                "title": t.title,
                "issue_key": t.issue_key,
                "archived": t.archived_at is not None,
                "closed_month": month_label,
                "logged_minutes": int(logged or 0),
            }
        )
    out.sort(key=lambda x: x["closed_month"] or "")
    from app.core.timeutils import format_jalali_date, jalali_parts, get_tz as _gtz

    cutoff_local = cutoff.astimezone(_gtz(user.timezone)).date()
    return {"cutoff_date": cutoff_local.isoformat(), "cutoff_label": format_jalali_date(cutoff_local), "candidates": out}


@router.get("/tasks/{task_id}", response_model=TaskDetail)
def get_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    return TaskDetail(**build_task_detail(db, task))


@router.patch("/tasks/{task_id}", response_model=TaskDetail)
def update_task(task_id: uuid.UUID, body: TaskUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    data = body.model_dump(exclude_unset=True)

    # Placement changes
    if data.get("to_standalone"):
        task.area_id = None
        task.project_id = None
    else:
        if data.get("project_id") is not None:
            _, project_id = _validate_parents(db, user, None, data["project_id"])
            task.project_id = project_id
            task.area_id = None
        elif data.get("area_id") is not None:
            area_id, _ = _validate_parents(db, user, data["area_id"], None)
            task.area_id = area_id
            task.project_id = None

    simple_fields = ["title", "description", "notes", "estimate_minutes", "priority", "due_date", "due_time", "recurrence_rule"]
    for f in simple_fields:
        if f in data and data[f] is not None:
            setattr(task, f, data[f])
    if data.get("priority") is not None:
        task.priority = TaskPriority(data["priority"]).value
    if data.get("task_type") is not None:
        task.task_type = TaskType(data["task_type"]).value
    if data.get("clear_estimate"):
        task.estimate_minutes = None
    if data.get("clear_due_date"):
        task.due_date = None
    if data.get("clear_due_time"):
        task.due_time = None
    if data.get("clear_recurrence"):
        task.recurrence_rule = None
    if data.get("tag_ids") is not None:
        _set_tags(db, user, task, data["tag_ids"])

    old_status = task.status
    if data.get("status") is not None:
        new_status = TaskStatus(data["status"]).value
        if new_status == TaskStatus.closed.value and old_status != TaskStatus.closed.value:
            task.status = new_status
            task.closed_at = utcnow()
            # Completed tasks move to the archive automatically; they stay
            # visible on the sprint board until removed and remain restorable.
            if task.archived_at is None:
                task.archived_at = utcnow()
            create_next_occurrence(db, user, task)
        elif new_status != TaskStatus.closed.value and old_status == TaskStatus.closed.value:
            task.status = new_status
            task.closed_at = None
            # Reopening brings the task back out of the (auto-)archive.
            task.archived_at = None
        else:
            task.status = new_status

    db.commit()
    db.refresh(task)
    return TaskDetail(**build_task_detail(db, task))


def _task_delete_preview(db, user, task: Task) -> DeletePreviewOut:
    minutes = db.query(func.coalesce(func.sum(TimeEntry.minutes), 0)).filter(TimeEntry.task_id == task.id).scalar()
    entry_count = db.query(func.count()).select_from(TimeEntry).filter(TimeEntry.task_id == task.id).scalar()
    return DeletePreviewOut(tasks=1, time_entries=int(entry_count or 0), logged_minutes=int(minutes or 0))


@router.get("/tasks/{task_id}/delete-preview", response_model=DeletePreviewOut)
def task_delete_preview(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    return _task_delete_preview(db, user, task)


@router.post("/tasks/{task_id}/archive")
def archive_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    if task.archived_at is None:
        task.archived_at = utcnow()
        db.commit()
    return {"ok": True}


@router.post("/tasks/{task_id}/restore")
def restore_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    task.archived_at = None
    db.commit()
    return {"ok": True}


@router.delete("/tasks/{task_id}")
def delete_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    db.delete(task)
    db.commit()
    return {"ok": True}


# ---------------- Dependencies (blocking) ----------------

_KEY_SEARCH_RE = re.compile(r"^([a-zA-Z]{2,10})[-/ _]?(\d{1,6})$")


def _resolve_blocker(db: Session, user: User, body: DependencyAddIn) -> Task:
    if body.blocker_id is not None:
        blocker = db.get(Task, body.blocker_id)
        if blocker is None or blocker.user_id != user.id:
            raise HTTPException(status_code=404, detail="تسکِ سدکننده پیدا نشد.")
        return blocker
    raw = (body.blocker_ref or "").strip()
    m = _KEY_SEARCH_RE.match(raw)
    key = f"{m.group(1).upper()}-{int(m.group(2)):03d}" if m else raw.upper()
    blocker = db.scalar(select(Task).where(Task.user_id == user.id, Task.issue_key == key))
    if blocker is None:
        raise HTTPException(status_code=404, detail=f"تسکی با کلید «{raw}» پیدا نشد.")
    return blocker


@router.post("/tasks/{task_id}/dependencies", response_model=TaskDetail)
def add_dependency(task_id: uuid.UUID, body: DependencyAddIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    blocker = _resolve_blocker(db, user, body)
    if blocker.id == task.id:
        raise HTTPException(status_code=422, detail="یک تسک نمی‌تواند خودش را سد کند.")
    existing = db.scalar(
        select(TaskDependency).where(TaskDependency.blocker_id == blocker.id, TaskDependency.blocked_id == task.id)
    )
    if existing is None:
        db.add(TaskDependency(user_id=user.id, blocker_id=blocker.id, blocked_id=task.id))
        db.commit()
    db.refresh(task)
    return TaskDetail(**build_task_detail(db, task))


@router.delete("/tasks/{task_id}/dependencies/{blocker_id}", response_model=TaskDetail)
def remove_dependency(task_id: uuid.UUID, blocker_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    edge = db.scalar(
        select(TaskDependency).where(TaskDependency.blocker_id == blocker_id, TaskDependency.blocked_id == task.id)
    )
    if edge is not None:
        db.delete(edge)
        db.commit()
    db.refresh(task)
    return TaskDetail(**build_task_detail(db, task))


# ---------------- Subtasks ----------------

@router.post("/tasks/{task_id}/subtasks", response_model=SubtaskOut)
def add_subtask(task_id: uuid.UUID, body: SubtaskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    order = db.query(func.coalesce(func.max(Subtask.sort_order), -1)).filter(Subtask.task_id == task.id).scalar() + 1
    st = Subtask(task_id=task.id, title=body.title, sort_order=order)
    db.add(st)
    db.commit()
    db.refresh(st)
    return st


def _get_subtask(db, user, subtask_id) -> Subtask:
    st = db.get(Subtask, subtask_id)
    if st is None or st.task.user_id != user.id:
        raise HTTPException(status_code=404, detail="زیرتسک پیدا نشد.")
    return st


@router.patch("/subtasks/{subtask_id}", response_model=SubtaskOut)
def update_subtask(subtask_id: uuid.UUID, body: SubtaskUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    st = _get_subtask(db, user, subtask_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(st, field, value)
    db.commit()
    db.refresh(st)
    return st


@router.delete("/subtasks/{subtask_id}")
def delete_subtask(subtask_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    st = _get_subtask(db, user, subtask_id)
    db.delete(st)
    db.commit()
    return {"ok": True}


# ---------------- Tags ----------------

@router.get("/tags", response_model=list[TagOut])
def list_tags(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tags = db.scalars(select(Tag).where(Tag.user_id == user.id).order_by(Tag.name)).all()
    return tags


@router.post("/tags", response_model=TagOut)
def create_tag(body: TagIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = body.name.strip().lower()
    existing = db.scalar(select(Tag).where(Tag.user_id == user.id, Tag.name == name))
    if existing:
        return existing
    tag = Tag(user_id=user.id, name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tag = db.get(Tag, tag_id)
    if tag is None or tag.user_id != user.id:
        raise HTTPException(status_code=404, detail="برچسب پیدا نشد.")
    db.delete(tag)
    db.commit()
    return {"ok": True}
