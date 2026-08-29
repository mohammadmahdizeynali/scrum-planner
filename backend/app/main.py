from contextlib import asynccontextmanager

import asyncio

from fastapi import FastAPI
from sqlalchemy import func, select

from app.api import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db import Base, SessionLocal, engine
from app.models import User
from app.services.backup import backup_scheduler_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    seed_admin()
    scheduler = asyncio.create_task(backup_scheduler_loop())
    try:
        yield
    finally:
        scheduler.cancel()


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
