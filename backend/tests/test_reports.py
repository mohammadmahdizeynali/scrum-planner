from datetime import datetime, timedelta, timezone

from app.core.timeutils import jalali_month_of, week_start_utc
from app.services.sprints import build_weekly_payload


def _week_datetime_this_week(hour: int) -> str:
    start = week_start_utc(datetime.now(timezone.utc), "Asia/Tehran")
    return (start + timedelta(days=1, hours=hour)).isoformat()


def test_weekly_payload_aggregation(auth_client, area, project):
    from app.db import SessionLocal
    from app.models import Sprint
    from app.core.timeutils import week_start_utc
    from datetime import datetime as dt
    from app.services.sprints import build_weekly_payload

    t1 = auth_client.post("/api/v1/tasks", json={"title": "Lecture notes", "project_id": project["id"], "estimate_minutes": 120}).json()
    t2 = auth_client.post("/api/v1/tasks", json={"title": "Standalone chore"}).json()

    # Weekly reports only include tasks that are sprint members (inclusion rule).
    current = auth_client.get("/api/v1/sprints/current").json()
    r = auth_client.post(
        f"/api/v1/sprints/{current['id']}/tasks",
        json={"items": [{"task_id": t1["id"]}, {"task_id": t2["id"]}]},
    )
    assert r.status_code == 200, r.text

    start = week_start_utc(dt.now(timezone.utc), "Asia/Tehran")
    auth_client.post("/api/v1/time-entries", json={
        "task_id": t1["id"], "start_at": (start + timedelta(days=1, hours=9)).isoformat(),
        "end_at": (start + timedelta(days=1, hours=11)).isoformat(),  # 120 min
    })
    auth_client.post("/api/v1/time-entries", json={
        "task_id": t1["id"], "start_at": (start + timedelta(days=2, hours=9)).isoformat(),
        "end_at": (start + timedelta(days=2, hours=10, minutes=30)).isoformat(),  # 90 min, billable
        "billable": True,
    })
    auth_client.post("/api/v1/time-entries", json={
        "task_id": t2["id"], "start_at": (start + timedelta(days=3, hours=9)).isoformat(),
        "end_at": (start + timedelta(days=3, hours=9, minutes=45)).isoformat(),  # 45 min standalone
    })

    db = SessionLocal()
    try:
        from sqlalchemy import select

        from app.models import User

        auth_client.get("/api/v1/sprints/current")  # ensure the sprint row exists
        sprint = db.scalars(select(Sprint).where(Sprint.start_at == start)).first()
        user = db.scalars(select(User)).first()
        payload = build_weekly_payload(db, user, sprint)
    finally:
        db.close()

    assert payload["total_minutes"] == 120 + 90 + 45
    assert payload["billable_minutes"] == 90
    uni = next(a for a in payload["areas"] if a["name"] == "University")
    assert uni["minutes"] == 210
    assert uni["projects"][0]["minutes"] == 210
    standalone = next(a for a in payload["areas"] if a["area_id"] is None)
    assert standalone["minutes"] == 45
    est = payload["estimate"]["projects"][0]
    assert est["estimate_minutes"] == 120 and est["logged_minutes"] == 210


def test_monthly_report_bucketing(auth_client, area):
    jy, jm = jalali_month_of(datetime.now(timezone.utc), "Asia/Tehran")
    r = auth_client.get("/api/v1/reports/monthly", params={"jy": jy, "jm": jm})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["kind"] == "monthly" and data["jy"] == jy and data["jm"] == jm
    assert data["weeks"] is not None


def test_timezone_week_boundary(auth_client):
    """An entry at Saturday 00:30 Tehran (= Friday 21:00 UTC) belongs to the NEW week."""
    from datetime import datetime as dt

    from app.db import SessionLocal
    from app.models import Sprint
    from sqlalchemy import select

    # find next Saturday 00:00 Tehran
    now = dt.now(timezone.utc)
    start = week_start_utc(now, "Asia/Tehran")
    saturday_0030_tehran = start + timedelta(minutes=30)  # inside current week (Sat 00:30 Tehran)

    t = auth_client.post("/api/v1/tasks", json={"title": "boundary check"}).json()
    current = auth_client.get("/api/v1/sprints/current").json()  # contains Sat 00:30 Tehran
    r = auth_client.post(f"/api/v1/sprints/{current['id']}/tasks", json={"items": [{"task_id": t["id"]}]})
    assert r.status_code == 200, r.text
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": t["id"],
        "start_at": saturday_0030_tehran.isoformat(),
        "end_at": (saturday_0030_tehran + timedelta(minutes=30)).isoformat(),
    })
    assert r.status_code == 200, r.text

    # In UTC this instant is Friday (20:30/21:00 UTC) — a naive UTC week bucket would
    # misattribute it to the previous week; our Tehran-aware bucketing must not.
    auth_client.get("/api/v1/sprints/current")  # ensure the sprint row exists
    db = SessionLocal()
    try:
        from sqlalchemy import select

        from app.models import User

        sprint = db.scalars(
            select(Sprint).where(
                Sprint.start_at == start,
                Sprint.user_id == auth_client.get("/api/v1/auth/me").json()["id"],
            )
        ).first()
        user = db.scalars(select(User)).first()
        payload = build_weekly_payload(db, user, sprint)
        total = sum(t2["minutes"] for t2 in payload["tasks"] if t2["title"] == "boundary check")
        assert total == 30
    finally:
        db.close()
