import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Event, User
from app.schemas import EventIn, EventOut, EventUpdateIn

router = APIRouter(prefix="/events", tags=["events"])


def _get_event(db, user, event_id) -> Event:
    e = db.get(Event, event_id)
    if e is None or e.user_id != user.id:
        raise HTTPException(status_code=404, detail="رویداد پیدا نشد.")
    return e


@router.get("", response_model=list[EventOut])
def list_events(
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Event).where(Event.user_id == user.id)
    if from_date is not None:
        q = q.where(Event.event_date >= from_date)
    if to_date is not None:
        q = q.where(Event.event_date <= to_date)
    events = db.scalars(q.order_by(Event.event_date, Event.event_time.nullsfirst(), Event.created_at)).all()
    return events


@router.post("", response_model=EventOut)
def create_event(body: EventIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = Event(user_id=user.id, **body.model_dump())
    db.add(e)
    db.commit()
    db.refresh(e)
    return e


@router.patch("/{event_id}", response_model=EventOut)
def update_event(event_id: uuid.UUID, body: EventUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get_event(db, user, event_id)
    data = body.model_dump(exclude_unset=True)
    if data.pop("clear_event_time", False):
        e.event_time = None
    for field, value in data.items():
        setattr(e, field, value)
    db.commit()
    db.refresh(e)
    return e


@router.delete("/{event_id}")
def delete_event(event_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    e = _get_event(db, user, event_id)
    db.delete(e)
    db.commit()
    return {"ok": True}
