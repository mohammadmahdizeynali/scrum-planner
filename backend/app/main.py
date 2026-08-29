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


def ensure_schema_upgrades() -> None:
    """Lightweight column additions for already-deployed databases.

    create_all() only creates missing *tables*; these ALTERs bring older live
    databases up to the current model. Runs on every boot and is idempotent.
    """
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    stmts: list[str] = []
    if "areas" in tables:
        cols = {c["name"] for c in insp.get_columns("areas")}
        if "key_prefix" not in cols:
            stmts.append("ALTER TABLE areas ADD COLUMN key_prefix VARCHAR(16)")
        if "task_counter" not in cols:
            stmts.append("ALTER TABLE areas ADD COLUMN task_counter INTEGER NOT NULL DEFAULT 0")
    if "tasks" in tables:
        cols = {c["name"] for c in insp.get_columns("tasks")}
        if "issue_key" not in cols:
            stmts.append("ALTER TABLE tasks ADD COLUMN issue_key VARCHAR(24)")
    with engine.begin() as conn:
        for s in stmts:
            conn.execute(text(s))
    with engine.begin() as conn:
        for s in (
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_areas_key_prefix ON areas (key_prefix)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_issue_key ON tasks (issue_key)",
        ):
            conn.execute(text(s))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema_upgrades()
    backfill_issue_keys()
    seed_admin()
    scheduler = asyncio.create_task(backup_scheduler_loop())
    try:
        yield
    finally:
        scheduler.cancel()


def backfill_issue_keys() -> None:
    """One-time-per-boot safety net: every prefixed area's key-less tasks get keys."""
    from sqlalchemy import select

    from app.models import Area
    from app.services.issue_keys import assign_missing_keys

    db = SessionLocal()
    try:
        areas = db.scalars(select(Area).where(Area.key_prefix.isnot(None))).all()
        for area in areas:
            assign_missing_keys(db, area)
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


app = FastAPI(title="Personal Planner API", lifespan=lifespan)
app.include_router(api_router, prefix="/api/v1")


@app.get("/api/health")
def health():
    return {"ok": True}
