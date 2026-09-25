import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Sprint, SprintMembership, Task, TimeEntry, User
from app.schemas import (
    SprintAddTasksIn,
    SprintCloseIn,
    SprintDetail,
    SprintMemberOut,
    SprintOut,
)
from app.services import sprints as sprint_service
from app.services.builders import entry_window_filter

router = APIRouter(prefix="/sprints", tags=["sprints"])


def _detail(db: Session, sprint: Sprint, user: User) -> SprintDetail:
    members = sprint_service.sprint_members_with_tasks(db, sprint)
    ids = [t["id"] for _, t in members]
    logged = 0
    billable = 0
    if ids:
        row = (
            db.query(func.sum(TimeEntry.minutes), func.sum(case((TimeEntry.billable.is_(True), TimeEntry.minutes), else_=0)))
            .join(Task, Task.id == TimeEntry.task_id)
            .join(SprintMembership, SprintMembership.task_id == Task.id)
            .filter(
                SprintMembership.sprint_id == sprint.id,
                entry_window_filter(sprint.start_at, sprint.end_at, user.timezone),
            )
            .first()
        )
        logged = int(row[0] or 0)
        billable = int(row[1] or 0)
    estimate = sum(t["estimate_minutes"] or 0 for _, t in members)
    return SprintDetail(
        id=sprint.id,
        name=sprint.name,
        start_at=sprint.start_at,
        end_at=sprint.end_at,
        status=sprint.status,
        closed_at=sprint.closed_at,
        members=[SprintMemberOut(source=m.source, task=t) for m, t in members],
        logged_minutes=logged,
        billable_minutes=billable,
        estimate_minutes=int(estimate),
        count_open=sum(1 for _, t in members if t["status"] == "open"),
        count_in_progress=sum(1 for _, t in members if t["status"] == "in_progress"),
        count_closed=sum(1 for _, t in members if t["status"] == "closed"),
    )


@router.get("/current", response_model=SprintDetail)
def get_current_sprint(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = sprint_service.current_sprint(db, user)
    return _detail(db, sprint, user)


@router.get("/current/suggestions")
def planning_suggestions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Read-only planning assistant: reason-tagged task suggestions for the
    active sprint. Nothing is mutated here — the UI confirms via the
    add-tasks endpoint."""
    sprint = sprint_service.current_sprint(db, user)
    if sprint.status != "active":
        return {"suggestions": []}
    suggestions = sprint_service.planning_suggestions(db, user, sprint)
    return {"suggestions": [{"task": s["task"], "reasons": s["reasons"]} for s in suggestions]}


@router.get("", response_model=list[SprintOut])
def list_sprints(
    from_dt: datetime | None = Query(default=None, alias="from"),
    to_dt: datetime | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Sprint).where(Sprint.user_id == user.id).order_by(Sprint.start_at.desc())
    if from_dt is not None:
        q = q.where(Sprint.end_at > from_dt)
    if to_dt is not None:
        q = q.where(Sprint.start_at < to_dt)
    return db.scalars(q.limit(200)).all()


@router.get("/next", response_model=SprintDetail | None)
def get_next_sprint(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The sprint following the current one, if it exists yet (e.g. created by
    an early close or carry-over). Used for the current/next scheduled view."""
    current = sprint_service.current_sprint(db, user)
    nxt = db.scalar(select(Sprint).where(Sprint.user_id == user.id, Sprint.start_at == current.end_at))
    return _detail(db, nxt, user) if nxt is not None else None


@router.get("/{sprint_id}", response_model=SprintDetail)
def get_sprint(sprint_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    return _detail(db, sprint, user)



@router.post("/current/tasks", response_model=SprintDetail)
def add_task_to_current_sprint(body: SprintAddTasksIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Shortcut used by the Warehouse quick-add: resolve the current sprint
    and add tasks to it in one call."""
    sprint = sprint_service.current_sprint(db, user)
    if sprint.status != "active":
        raise HTTPException(status_code=409, detail="اسپرینت این هفته بسته شده است؛ ابتدا بازگشایی کنید.")
    sprint_service.add_tasks_to_sprint(db, user, sprint, body.items)
    return _detail(db, sprint, user)


@router.post("/{sprint_id}/tasks", response_model=SprintDetail)
def add_tasks(sprint_id: uuid.UUID, body: SprintAddTasksIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    if sprint.status != "active":
        raise HTTPException(status_code=409, detail="به اسپرینت بسته‌شده نمی‌توان تسک اضافه کرد.")
    sprint_service.add_tasks_to_sprint(db, user, sprint, body.items)
    return _detail(db, sprint, user)


@router.delete("/{sprint_id}/tasks/{task_id}", response_model=SprintDetail)
def remove_task(sprint_id: uuid.UUID, task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    if sprint.status != "active":
        raise HTTPException(status_code=409, detail="این اسپرینت بسته شده است؛ برای تغییر، ابتدا بازگشایی کنید.")
    sprint_service.remove_task_from_sprint(db, user, sprint, task_id)
    return _detail(db, sprint, user)


@router.post("/{sprint_id}/close")
def close_sprint(sprint_id: uuid.UUID, body: SprintCloseIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    return sprint_service.close_sprint(db, user, sprint, body.decisions)


@router.post("/{sprint_id}/reopen", response_model=SprintDetail)
def reopen_sprint(sprint_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    sprint_service.reopen_sprint(db, user, sprint)
    return _detail(db, sprint, user)
