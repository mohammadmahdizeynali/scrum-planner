from datetime import datetime, timezone

from app.services.backup import (
    _build_zip_sync,
    next_backup_slot_utc,
    prev_backup_slot_utc,
    prev_backup_slot_utc as prev_slot,
)
import zipfile


def test_next_slot_is_saturday_0200_tehran():
    # Friday 2026-08-28 10:00 UTC = 13:30 Tehran → next slot: Sat 02:00 Tehran = Fri 22:30 UTC
    now = datetime(2026, 8, 28, 10, 0, tzinfo=timezone.utc)
    nxt = next_backup_slot_utc(now, "Asia/Tehran")
    assert nxt == datetime(2026, 8, 28, 22, 30, tzinfo=timezone.utc)

    # exactly at the slot → next week
    at_slot = datetime(2026, 8, 28, 22, 30, tzinfo=timezone.utc)
    nxt2 = next_backup_slot_utc(at_slot, "Asia/Tehran")
    assert nxt2 == datetime(2026, 9, 4, 22, 30, tzinfo=timezone.utc)


def test_prev_slot_for_catchup():
    # Wednesday 2026-08-26 → most recent slot was Saturday 2026-08-22 02:00 Tehran
    # (= Friday 2026-08-21 22:30 UTC)
    now = datetime(2026, 8, 26, 12, 0, tzinfo=timezone.utc)
    assert prev_slot(now, "Asia/Tehran") == datetime(2026, 8, 21, 22, 30, tzinfo=timezone.utc)


def test_zip_contents(auth_client, monkeypatch):
    monkeypatch.setattr("app.services.backup.build_dump", lambda: b"CREATE TABLE dummy (id int);")
    data, name = _build_zip_sync()
    assert name.startswith("planner-backup-") and name.endswith(".zip")
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as z:
        names = set(z.namelist())
        assert "db.sql" in names
        assert "restore.sh" in names
        assert "RESTORE.md" in names
        assert z.read("db.sql") == b"CREATE TABLE dummy (id int);"


def test_backup_api_flow(auth_client, monkeypatch):
    monkeypatch.setattr("app.services.backup.build_dump", lambda: b"-- test dump")
    r = auth_client.post("/api/v1/backup/run")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["trigger"] == "manual"
    assert body["deliveries"][0]["channel"] == "telegram"
    assert body["deliveries"][0]["ok"] is None  # not configured in tests

    status = auth_client.get("/api/v1/backup/status").json()
    assert status["telegram_configured"] is False
    assert status["github_configured"] is False
    assert any(f["name"] == body["name"] for f in status["files"])

    r = auth_client.get(f"/api/v1/backup/download/{body['name']}")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"

    # path traversal / bad names rejected
    assert auth_client.get("/api/v1/backup/download/evil.zip").status_code == 422
