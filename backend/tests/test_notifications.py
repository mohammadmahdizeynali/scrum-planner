from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services.notifications import (
    daily_briefing_text,
    evening_summary_text,
    next_daily_slot_utc,
)
from app.db import SessionLocal
from sqlalchemy import select

from app.models import User


def _db_and_user():
    db = SessionLocal()
    user = db.scalars(select(User).order_by(User.created_at)).first()
    return db, user


def test_next_daily_slot_basic():
    # Friday 10:00 UTC = 13:30 Tehran → next 06:00 slot = Saturday 02:30 UTC
    now = datetime(2026, 8, 28, 10, 0, tzinfo=timezone.utc)
    assert next_daily_slot_utc(now, "Asia/Tehran", 6) == datetime(2026, 8, 29, 2, 30, tzinfo=timezone.utc)
    # exactly at the slot → tomorrow
    at_slot = datetime(2026, 8, 29, 2, 30, tzinfo=timezone.utc)
    assert next_daily_slot_utc(at_slot, "Asia/Tehran", 6) == datetime(2026, 8, 30, 2, 30, tzinfo=timezone.utc)


def test_daily_briefing_contains_sprint_and_deadlines(auth_client, area, project):
    s = auth_client.get("/api/v1/sprints/current").json()
    if s["status"] == "closed":  # earlier tests in the session close the current sprint
        auth_client.post(f"/api/v1/sprints/{s['id']}/reopen")
    auth_client.patch(f"/api/v1/areas/{area['id']}", json={"key_prefix": "SBU"})
    t1 = auth_client.post(
        "/api/v1/tasks",
        json={"title": "خواندن فصل ۳", "project_id": project["id"], "estimate_minutes": 120, "due_date": _tehran_today()},
    ).json()
    # add-to-sprint needs the sprint UUID — "current" is only a GET alias
    r = auth_client.post(f"/api/v1/sprints/{s['id']}/tasks", json={"items": [{"task_id": t1["id"]}]})
    assert r.status_code == 200, r.text

    now = datetime.now(timezone.utc)
    db, user = _db_and_user()
    try:
        text = daily_briefing_text(db, user, now=now)
    finally:
        db.close()

    assert "صبح بخیر" in text
    assert "SBU-001" in text and "خواندن فصل ۳" in text
    assert "برآورد 2h" in text
    assert "مهلت‌ها" in text and "📅 امروز" in text


def test_evening_summary_lists_logged_tasks(auth_client, task):
    tz = ZoneInfo("Asia/Tehran")
    now = datetime.now(timezone.utc)
    today = now.astimezone(tz).date()
    start = datetime.combine(today, time(9, 0), tzinfo=tz).astimezone(timezone.utc)
    r = auth_client.post(
        "/api/v1/time-entries",
        json={
            "task_id": task["id"],
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(minutes=150)).isoformat(),
        },
    )
    assert r.status_code == 200, r.text

    db, user = _db_and_user()
    try:
        text = evening_summary_text(db, user, now=now)
    finally:
        db.close()

    assert "گزارش امروز" in text
    assert "2h 30 min" in text
    assert task["title"] in text


def _tehran_today() -> str:
    now = datetime.now(timezone.utc).astimezone(ZoneInfo("Asia/Tehran"))
    return now.date().isoformat()


def test_chunks_respect_telegram_limit():
    from app.services.notifications import _chunks

    long_text = "\n".join(f"line {i} — " + "x" * 50 for i in range(200))
    parts = _chunks(long_text)
    assert all(len(p) <= 3900 for p in parts)
    assert "\n".join(parts).replace("\n\n", "\n") >= long_text[:100]  # sanity
    assert sum(len(p) for p in parts) >= len(long_text) - 200  # nothing meaningfully lost


def test_notify_preview_endpoint(auth_client):
    r = auth_client.get("/api/v1/notify/preview", params={"type": "morning"})
    assert r.status_code == 200, r.text
    assert r.json()["type"] == "morning"
    r = auth_client.get("/api/v1/notify/preview", params={"type": "evening"})
    assert r.status_code == 200
    assert "گزارش امروز" in r.json()["text"]
