from fastapi import APIRouter

from app.api import auth, backup, notify, reports, sprints, structure, tasks, time_entries, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(structure.router)
api_router.include_router(tasks.router)
api_router.include_router(sprints.router)
api_router.include_router(time_entries.router)
api_router.include_router(reports.router)
api_router.include_router(backup.router)
api_router.include_router(notify.router)
