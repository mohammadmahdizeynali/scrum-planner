from contextlib import asynccontextmanager

import asyncio

from fastapi import FastAPI
from sqlalchemy import func, inspect, select, text

from app.api import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db import Base, SessionLocal, engine
from app.models import User
from app.services.backup import backup_scheduler_loop
from app.services.notifications import notifications_scheduler_loop


def ensure_schema_upgrades() -> None:
    """Lightweight column additions for already-deployed databases.

    create_all() only creates missing *tables*; these ALTERs bring older live
    databases up to the current model. Runs on every boot and is idempotent.
    """
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    stmts: list[str] = []
    if "users" in tables:
        cols = {c["name"] for c in insp.get_columns("users")}
        if "is_active" not in cols:
            stmts.append("ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE")
    if "areas" in tables:
        cols = {c["name"] for c in insp.get_columns("areas")}
        if "key_prefix" not in cols:
            stmts.append("ALTER TABLE areas ADD COLUMN key_prefix VARCHAR(16)")
        if "task_counter" not in cols:
            stmts.append("ALTER TABLE areas ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0")
        if "default_task_type" not in cols:
            stmts.append("ALTER TABLE areas ADD COLUMN default_task_type VARCHAR(16)")
    if "projects" in tables:
        cols = {c["name"] for c in insp.get_columns("projects")}
        if "parent_project_id" not in cols:
            stmts.append(
                "ALTER TABLE projects ADD COLUMN parent_project_id UUID REFERENCES projects(id) ON DELETE CASCADE"
            )
            stmts.append("CREATE INDEX IF NOT EXISTS ix_projects_parent_project_id ON projects (parent_project_id)")
        if "key_prefix" not in cols:
            stmts.append("ALTER TABLE projects ADD COLUMN key_prefix VARCHAR(16)")
        if "task_counter" not in cols:
            stmts.append("ALTER TABLE projects ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0")
        if "default_task_type" not in cols:
            stmts.append("ALTER TABLE projects ADD COLUMN default_task_type VARCHAR(16)")
        if "closed_at" not in cols:
            stmts.append("ALTER TABLE projects ADD COLUMN closed_at TIMESTAMPTZ")
    if "tasks" in tables:
        cols = {c["name"] for c in insp.get_columns("tasks")}
        if "issue_key" not in cols:
            stmts.append("ALTER TABLE tasks ADD COLUMN issue_key VARCHAR(24)")
        if "archived_at" not in cols:
            stmts.append("ALTER TABLE tasks ADD COLUMN archived_at TIMESTAMPTZ")
        if "task_type" not in cols:
            stmts.append("ALTER TABLE tasks ADD COLUMN task_type VARCHAR(16) NOT NULL DEFAULT 'timed'")
        if "due_time" not in cols:
            stmts.append("ALTER TABLE tasks ADD COLUMN due_time TIME")
    if "time_entries" in tables:
        cols = {c["name"] for c in insp.get_columns("time_entries")}
        if "logged_date" not in cols:
            stmts.append("ALTER TABLE time_entries ADD COLUMN logged_date DATE")
            stmts.append("CREATE INDEX IF NOT EXISTS ix_time_entries_logged_date ON time_entries (logged_date)")
        # start/end become nullable for duration-only entries; the CHECK is relaxed to match.
        stmts.append("ALTER TABLE time_entries ALTER COLUMN start_at DROP NOT NULL")
        stmts.append("ALTER TABLE time_entries ALTER COLUMN end_at DROP NOT NULL")
        stmts.append("ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS ck_entry_order")
        stmts.append(
            "ALTER TABLE time_entries ADD CONSTRAINT ck_entry_order CHECK ("
            "(start_at IS NULL AND end_at IS NULL) OR (start_at IS NOT NULL AND end_at IS NOT NULL AND end_at > start_at))"
        )
    with engine.begin() as conn:
        for s in stmts:
            conn.execute(text(s))
    with engine.begin() as conn:
        for s in (
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_areas_key_prefix ON areas (key_prefix)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_issue_key ON tasks (issue_key)",
            # Key prefixes share one namespace (areas + projects) so task keys never collide.
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_key_prefix ON projects (key_prefix) WHERE key_prefix IS NOT NULL",
        ):
            conn.execute(text(s))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema_upgrades()
    backfill_issue_keys()
    seed_admin()
    scheduler = asyncio.create_task(backup_scheduler_loop())
    notifier = asyncio.create_task(notifications_scheduler_loop())
    try:
        yield
    finally:
        scheduler.cancel()
        notifier.cancel()


def backfill_issue_keys() -> None:
    """One-time-per-boot safety net: every prefixed area's and project's key-less
    tasks get keys."""
    from sqlalchemy import select

    from app.models import Area, Project
    from app.services.issue_keys import assign_missing_keys, assign_missing_project_keys

    db = SessionLocal()
    try:
        areas = db.scalars(select(Area).where(Area.key_prefix.isnot(None))).all()
        for area in areas:
            assign_missing_keys(db, area)
        projects = db.scalars(select(Project).where(Project.key_prefix.isnot(None))).all()
        for project in projects:
            assign_missing_project_keys(db, project)
        db.commit()
    finally:
        db.close()


def seed_admin() -> None:
    db = SessionLocal()
    try:
        count = db.scalar(select(func.count()).select_from(User))
        if count == 0:
            db.add(
                User(
                    username=settings.admin_username.strip().lower(),
                    password_hash=hash_password(settings.admin_password),
                    display_name=settings.admin_display_name,
                    timezone=settings.default_timezone,
                    role="admin",
                )
            )
            db.commit()
            print(f"Seeded admin user '{settings.admin_username}'")
    finally:
        db.close()


app = FastAPI(title="Personal Planner API", version="1.1.0", lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health")
def health():
    return {"ok": True}
