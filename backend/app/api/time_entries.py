import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutils import to_utc
from app.db import get_db
from app.deps import get_current_user
from app.models import Area, Project, Task, TimeEntry, User
from app.schemas import EntryIn, EntryOut, EntryUpdateIn
from app.services.builders import entry_out, entries_for_range

router = APIRouter(prefix="/time-entries", tags=["time-entries"])


def _validate_times(start_at: datetime, end_at: datetime) -> tuple[datetime, datetime, int]:
    start = to_utc(start_at)
    end = to_utc(end_at)
    if end <= start:
        raise HTTPException(status_code=422, detail="زمان پایان باید بعد از زمان شروع باشد.")
    minutes = int((end - start).total_seconds() // 60)
    if minutes > 1440:
        raise HTTPException(status_code=422, detail="یک ثبت زمان نمی‌تواند بیشتر از ۲۴ ساعت باشد.")
    return start, end, minutes


def _default_billable(db: Session, task: Task) -> bool:
    if task.project_id is not None:
        project = db.get(Project, task.project_id)
        if project:
            area = db.get(Area, project.area_id)
            return bool(area and area.billable_default)
    if task.area_id is not None:
        area = db.get(Area, task.area_id)
        return bool(area and area.billable_default)
    return False


def _get_entry(db, user, entry_id) -> TimeEntry:
    e = db.get(TimeEntry, entry_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(status_code=404, detail="ثبت زمان پیدا نشد.")
    return e


def _entry_out(db, e: TimeEntry) -> dict:
    task = db.get(Task, e.task_id)
    color = None
    if task is not None:
        if task.project_id is not None:
            project = db.get(Project, task.project_id)
            if project:
                area = db.get(Area, project.area_id)
                color = area.color if area else None
        elif task.area_id is not None:
            area = db.get(Area, task.area_id)
            color = area.color if area else None
    return entry_out(e, task_title=task.title if task else "", area_color=color)


@router.get("")
def list_entries(
    start: datetime = Query(...),
    end: datetime = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return entries_for_range(db, user.id, to_utc(start), to_utc(end), tz_name=user.timezone)


@router.post("", response_model=EntryOut)
def create_entry(body: EntryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.get(Task, body.task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
    billable = body.billable if body.billable is not None else _default_billable(db, task)
    if body.start_at is not None:
        # Session mode: a real start → end block.
        start, end, minutes = _validate_times(body.start_at, body.end_at)
        e = TimeEntry(
            user_id=user.id,
            task_id=task.id,
            start_at=start,
            end_at=end,
            minutes=minutes,
            note=body.note,
            billable=billable,
        )
    else:
        # Duration mode: just an amount (e.g. 2h 30m) attributed to a day.
        e = TimeEntry(
            user_id=user.id,
            task_id=task.id,
            start_at=None,
            end_at=None,
            logged_date=body.logged_date,
            minutes=body.minutes,
            note=body.note,
            billable=billable,
        )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _entry_out(db, e)


@router.patch("/{entry_id}", response_model=EntryOut)
def update_entry(entry_id: uuid.UUID, body: EntryUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get_entry(db, user, entry_id)
    data = body.model_dump(exclude_unset=True)
    wants_session = data.get("start_at") is not None or data.get("end_at") is not None
    if wants_session:
        start = to_utc(data["start_at"]) if data.get("start_at") is not None else e.start_at
        end = to_utc(data["end_at"]) if data.get("end_at") is not None else e.end_at
        if start is None or end is None:
            raise HTTPException(status_code=422, detail="برای ثبت بازه‌ای، زمان شروع و پایان هر دو لازم است.")
        start, end, minutes = _validate_times(start, end)
        e.start_at = start
        e.end_at = end
        e.logged_date = None
        e.minutes = minutes
    elif data.get("minutes") is not None or "logged_date" in data:
        # Duration mode (or switching a session into one).
        e.start_at = None
        e.end_at = None
        if data.get("minutes") is not None:
            e.minutes = data["minutes"]
        if data.get("logged_date") is not None:
            e.logged_date = data["logged_date"]
        elif e.logged_date is None:
            from datetime import datetime, timezone

            e.logged_date = datetime.now(timezone.utc).date()
    if "task_id" in data and data["task_id"] is not None:
        task = db.get(Task, data["task_id"])
        if task is None or task.user_id != user.id:
            raise HTTPException(status_code=404, detail="تسک پیدا نشد.")
        e.task_id = task.id
    if "note" in data:
        e.note = data["note"]
    if "billable" in data and data["billable"] is not None:
        e.billable = data["billable"]
    db.commit()
    db.refresh(e)
    return _entry_out(db, e)


@router.delete("/{entry_id}")
def delete_entry(entry_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get_entry(db, user, entry_id)
    db.delete(e)
    db.commit()
    return {"ok": True}
