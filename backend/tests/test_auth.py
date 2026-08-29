from app.core import security

from .conftest import ADMIN_PASSWORD, ADMIN_USERNAME


def test_login_wrong_password(client):
    r = client.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": "nope"})
    assert r.status_code == 401


def test_me_requires_auth():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as fresh:
        r = fresh.get("/api/v1/auth/me")
        assert r.status_code == 401


def test_me_with_cookie(auth_client):
    r = auth_client.get("/api/v1/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == ADMIN_USERNAME
    assert r.json()["timezone"] == "Asia/Tehran"


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(security, "_LOGIN_MAX_ATTEMPTS", 2)
    for _ in range(2):
        client.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": "nope"})
    r = client.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 429


def test_update_profile_and_theme(auth_client):
    r = auth_client.patch("/api/v1/users/me", json={"theme": "dark", "display_name": "صاحب‌خانه"})
    assert r.status_code == 200
    assert r.json()["theme"] == "dark"
    r = auth_client.patch("/api/v1/users/me", json={"timezone": "Europe/Berlin"})
    assert r.json()["timezone"] == "Europe/Berlin"
    auth_client.patch("/api/v1/users/me", json={"timezone": "Asia/Tehran"})


def test_change_password_and_login_back(client):
    from fastapi.testclient import TestClient
    from app.main import app

    r = client.put("/api/v1/users/me/password", json={"current_password": ADMIN_PASSWORD, "new_password": "brand-new-pass-1"})
    assert r.status_code == 200
    with TestClient(app) as fresh:
        r = fresh.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
        assert r.status_code == 401
        r = fresh.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": "brand-new-pass-1"})
        assert r.status_code == 200
    # restore
    r = client.put("/api/v1/users/me/password", json={"current_password": "brand-new-pass-1", "new_password": ADMIN_PASSWORD})
    assert r.status_code == 200
