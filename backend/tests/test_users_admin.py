import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.main import app

from .conftest import ADMIN_USERNAME


def login_as(username: str, password: str) -> TestClient:
    """A fresh client with its own cookie jar, logged in as the given user."""
    c = TestClient(app)
    r = c.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return c


def login_failed(username: str, password: str):
    return TestClient(app).post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )


@pytest.fixture()
def make_user(auth_client):
    created: list[str] = []

    def _make(username: str, password: str = "member-pass-123", **kwargs) -> dict:
        r = auth_client.post("/api/v1/users", json={"username": username, "password": password, **kwargs})
        assert r.status_code == 201, r.text
        created.append(username)
        return r.json()

    yield _make

    for username in created:
        listed = auth_client.get("/api/v1/users").json()
        match = next((u for u in listed if u["username"] == username), None)
        if match:
            r = auth_client.delete(f"/api/v1/users/{match['id']}")
            assert r.status_code == 200, r.text


def test_admin_endpoints_require_auth():
    fresh = TestClient(app)  # own cookie jar — never logged in
    assert fresh.post("/api/v1/users", json={"username": "nope", "password": "long-enough-pw"}).status_code == 401
    assert fresh.get("/api/v1/users").status_code == 401


def test_admin_creates_user_with_empty_workspace(auth_client, make_user):
    u = make_user("alice.create", display_name="آلیس")
    assert u["role"] == "member"
    assert u["is_active"] is True
    assert u["display_name"] == "آلیس"

    alice = login_as("alice.create", "member-pass-123")
    me = alice.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice.create"
    # brand-new workspace: no areas, no tasks
    assert alice.get("/api/v1/areas").json() == []
    assert alice.get("/api/v1/tasks").json() == {"items": [], "total": 0}

    # alice can build her own workspace independently
    r = alice.post("/api/v1/areas", json={"name": "کارهای آلیس"})
    assert r.status_code == 200, r.text
    # ...and cannot touch admin endpoints
    assert alice.get("/api/v1/users").status_code == 403
    assert alice.patch(f"/api/v1/users/{u['id']}", json={"display_name": "x"}).status_code == 403
    assert alice.delete(f"/api/v1/users/{u['id']}").status_code == 403


def test_create_user_rejects_duplicates_and_bad_input(auth_client, make_user):
    make_user("bob.dup")
    # exact duplicate and case-insensitive duplicate
    assert auth_client.post("/api/v1/users", json={"username": "bob.dup", "password": "long-enough-pw"}).status_code == 409
    assert auth_client.post("/api/v1/users", json={"username": "Bob.Dup", "password": "long-enough-pw"}).status_code == 409

    assert auth_client.post("/api/v1/users", json={"username": "x", "password": "long-enough-pw"}).status_code == 422
    assert auth_client.post("/api/v1/users", json={"username": "short pw", "password": "long-enough-pw"}).status_code == 422
    assert auth_client.post("/api/v1/users", json={"username": "ok.name", "password": "short"}).status_code == 422
    assert auth_client.post(
        "/api/v1/users", json={"username": "ok.name", "password": "long-enough-pw", "timezone": "Mars/Olympus"}
    ).status_code == 422


def test_admin_lists_users(auth_client, make_user):
    make_user("carol.list")
    listed = auth_client.get("/api/v1/users").json()
    names = {u["username"] for u in listed}
    assert ADMIN_USERNAME in names
    assert "carol.list" in names
    admin_row = next(u for u in listed if u["username"] == ADMIN_USERNAME)
    assert admin_row["role"] == "admin"
    assert all("password_hash" not in u for u in listed)


def test_update_user_and_reset_password(auth_client, make_user):
    u = make_user("dave.reset")

    r = auth_client.patch(f"/api/v1/users/{u['id']}", json={"display_name": "دیو", "timezone": "Europe/Berlin"})
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "دیو"
    assert r.json()["timezone"] == "Europe/Berlin"

    dave = login_as("dave.reset", "member-pass-123")
    # admin resets the password → dave's existing session is revoked
    r = auth_client.patch(f"/api/v1/users/{u['id']}", json={"new_password": "brand-new-pw-9"})
    assert r.status_code == 200, r.text
    assert dave.get("/api/v1/auth/me").status_code == 401
    # old password no longer works, new one does
    assert login_failed("dave.reset", "member-pass-123").status_code == 401
    assert login_as("dave.reset", "brand-new-pw-9").get("/api/v1/auth/me").status_code == 200


def test_deactivate_and_reactivate_user(auth_client, make_user):
    u = make_user("erin.deact")
    erin = login_as("erin.deact", "member-pass-123")

    r = auth_client.patch(f"/api/v1/users/{u['id']}", json={"is_active": False})
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is False
    # existing session revoked, new logins refused
    assert erin.get("/api/v1/auth/me").status_code == 401
    blocked = login_failed("erin.deact", "member-pass-123")
    assert blocked.status_code == 403
    assert "غیرفعال" in blocked.json()["detail"]

    r = auth_client.patch(f"/api/v1/users/{u['id']}", json={"is_active": True})
    assert r.status_code == 200
    assert login_as("erin.deact", "member-pass-123").get("/api/v1/auth/me").status_code == 200


def test_admin_cannot_deactivate_or_delete_self(auth_client):
    me = auth_client.get("/api/v1/auth/me").json()
    assert auth_client.patch(f"/api/v1/users/{me['id']}", json={"is_active": False}).status_code == 400
    assert auth_client.delete(f"/api/v1/users/{me['id']}").status_code == 400


def test_delete_user_removes_account_and_workspace(auth_client, make_user):
    u = make_user("frank.del")
    frank = login_as("frank.del", "member-pass-123")
    area = frank.post("/api/v1/areas", json={"name": "مسیر فرانک", "key_prefix": "FRK"}).json()
    frank.post("/api/v1/tasks", json={"title": "کار فرانک", "area_id": area["id"]})

    assert auth_client.delete(f"/api/v1/users/{u['id']}").status_code == 200

    # account gone from the admin list, login refused
    assert all(x["username"] != "frank.del" for x in auth_client.get("/api/v1/users").json())
    assert login_failed("frank.del", "member-pass-123").status_code == 401

    # workspace data cascaded away
    from app.models import Area, Project, Task

    db = SessionLocal()
    try:
        uid = uuid.UUID(u["id"])
        assert db.scalar(select(func.count()).select_from(Area).where(Area.user_id == uid)) == 0
        assert db.scalar(select(func.count()).select_from(Task).where(Task.user_id == uid)) == 0
        assert db.scalar(select(func.count()).select_from(Project).where(Project.user_id == uid)) == 0
    finally:
        db.close()


def test_created_users_are_always_members(auth_client):
    # extra fields are ignored — role can never be set through the create API
    r = auth_client.post(
        "/api/v1/users", json={"username": "grace.role", "password": "long-enough-pw", "role": "admin"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "member"
    assert auth_client.delete(f"/api/v1/users/{r.json()['id']}").status_code == 200

    listed = auth_client.get("/api/v1/users").json()
    assert [u["username"] for u in listed if u["role"] == "admin"] == [ADMIN_USERNAME]
