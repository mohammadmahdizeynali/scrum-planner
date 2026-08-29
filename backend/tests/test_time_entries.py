from datetime import datetime, timedelta, timezone

from app.core.timeutils import jalali_parts, week_start_utc


def test_create_entry_defaults_billable_from_area(auth_client, area, task):
    auth_client.patch(f"/api/v1/areas/{area['id']}", json={"billable_default": True})
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"],
        "start_at": "2026-08-25T09:00:00+00:00",
        "end_at": "2026-08-25T10:30:00+00:00",
    })
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["minutes"] == 90 and e["billable"] is True and e["task_title"] == "Read chapter 3"
    auth_client.patch(f"/api/v1/areas/{area['id']}", json={"billable_default": False})


def test_entry_validation(auth_client, task):
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"], "start_at": "2026-08-25T10:00:00+00:00", "end_at": "2026-08-25T10:00:00+00:00",
    })
    assert r.status_code == 422
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"], "start_at": "2026-08-25T10:00:00+00:00", "end_at": "2026-08-27T10:01:00+00:00",
    })
    assert r.status_code == 422  # > 24h


def test_overlapping_entries_allowed(auth_client, area, project):
    t1 = auth_client.post("/api/v1/tasks", json={"title": "A", "project_id": project["id"]}).json()
    t2 = auth_client.post("/api/v1/tasks", json={"title": "B", "project_id": project["id"]}).json()
    for t in (t1, t2):
        r = auth_client.post("/api/v1/time-entries", json={
            "task_id": t["id"], "start_at": "2026-08-25T09:00:00+00:00", "end_at": "2026-08-25T10:00:00+00:00",
        })
        assert r.status_code == 200


def test_range_listing_and_edit(auth_client, task):
    auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"], "start_at": "2026-08-24T07:00:00+00:00", "end_at": "2026-08-24T08:00:00+00:00",
    })
    e = auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"], "start_at": "2026-08-25T07:00:00+00:00", "end_at": "2026-08-25T08:00:00+00:00",
    }).json()
    items = auth_client.get("/api/v1/time-entries", params={"start": "2026-08-24T00:00:00+00:00", "end": "2026-08-26T00:00:00+00:00"}).json()
    assert len(items) == 2

    r = auth_client.patch(f"/api/v1/time-entries/{e['id']}", json={"start_at": "2026-08-25T09:00:00+00:00", "end_at": "2026-08-25T10:15:00+00:00", "note": "صبح"})
    assert r.json()["minutes"] == 75
    assert r.status_code == 200
    r = auth_client.delete(f"/api/v1/time-entries/{e['id']}")
    assert r.status_code == 200


def test_midnight_crossing_entry_counts_on_start_day(auth_client, task):
    # 23:00 → 01:00 (+2h) crosses midnight; allowed, bucketed by start.
    r = auth_client.post("/api/v1/time-entries", json={
        "task_id": task["id"], "start_at": "2026-08-24T23:00:00+00:00", "end_at": "2026-08-25T01:00:00+00:00",
    })
    assert r.status_code == 200
    assert r.json()["minutes"] == 120
