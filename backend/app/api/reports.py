import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.timeutils import jalali_month_of, to_utc
from app.db import get_db
from app.deps import get_current_user
from app.models import Sprint, User, utcnow
from app.services.reports import build_monthly_payload, build_trend_payload
from app.services.sprints import build_weekly_payload

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/weekly/{sprint_id}")
def weekly_report(sprint_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sprint = db.get(Sprint, sprint_id)
    if sprint is None or sprint.user_id != user.id:
        raise HTTPException(status_code=404, detail="اسپرینت پیدا نشد.")
    if sprint.report is None:
        raise HTTPException(status_code=404, detail="برای این اسپرینت هنوز گزارشی بسته نشده است.")
    return {
        "generated_at": sprint.report.generated_at,
        "sprint_status": sprint.status,
        **sprint.report.payload,
    }


@router.get("/trends")
def trends(
    weeks: int = Query(default=8, ge=2, le=26),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Live per-week totals for the last N sprints — trend charts data."""
    return build_trend_payload(db, user, weeks)


@router.get("/monthly")
def monthly_report(
    jy: int | None = None,
    jm: int | None = Query(default=None, ge=1, le=12),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if jy is None or jm is None:
        jy, jm = jalali_month_of(to_utc(utcnow()), user.timezone)
    if not (1300 <= jy <= 1500):
        raise HTTPException(status_code=422, detail="سال شمسی نامعتبر است.")
    return build_monthly_payload(db, user, jy, jm)
