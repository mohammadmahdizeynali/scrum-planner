import os

os.environ["PLANNER_DATABASE_URL"] = "postgresql+psycopg://planner:dev@localhost:5433/planner_test"
os.environ["PLANNER_COOKIE_SECURE"] = "false"
os.environ["PLANNER_ADMIN_USERNAME"] = "admin"
os.environ["PLANNER_ADMIN_PASSWORD"] = "test-admin-pass"

import pytest
from fastapi.testclient import TestClient

from app.core import security
from app.db import Base, engine
from app.main import app

ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "test-admin-pass"
@pytest.fixture(scope="session")
def client():
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="session")
def auth_client(client):
    r = client.post("/api/v1/auth/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    security._login_attempts.clear()
    yield
    security._login_attempts.clear()


@pytest.fixture(autouse=True)
def clean_db(client):
    yield
    from sqlalchemy import text

    tables = [
        "weekly_reports", "sprint_memberships", "sprints", "time_entries",
        "task_tags", "tags", "subtasks", "tasks", "projects", "areas",
    ]
    with engine.begin() as conn:
        for t in tables:
            conn.execute(text(f"TRUNCATE TABLE {t} CASCADE"))


@pytest.fixture()
def area(auth_client):
    r = auth_client.post("/api/v1/areas", json={"name": "University", "color": "#3b82f6"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def project(auth_client, area):
    r = auth_client.post("/api/v1/projects", json={"area_id": area["id"], "name": "Course A"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture()
def task(auth_client, project):
    r = auth_client.post(
        "/api/v1/tasks",
        json={"title": "Read chapter 3", "project_id": project["id"], "estimate_minutes": 90},
    )
    assert r.status_code == 200, r.text
    return r.json()
