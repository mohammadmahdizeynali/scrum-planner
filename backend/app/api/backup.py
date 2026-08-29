import os
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings
from app.deps import get_current_user
from app.models import User
from app.services.backup import run_backup

router = APIRouter(prefix="/backup", tags=["backup"])

_ZIP_NAME = re.compile(r"^planner-backup-\d{8}-\d{4}\.zip$")


def _require_admin(user: User) -> None:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="فقط مدیر مجاز است.")


@router.get("/status")
def status(user: User = Depends(get_current_user)):
    _require_admin(user)
    files = []
    if os.path.isdir(settings.backup_dir):
        for f in sorted((x for x in os.listdir(settings.backup_dir) if x.endswith(".zip")), reverse=True):
            p = os.path.join(settings.backup_dir, f)
            try:
                files.append({"name": f, "size": os.path.getsize(p)})
            except OSError:
                pass
    return {
        "telegram_configured": bool(settings.backup_telegram_bot_token and settings.backup_telegram_chat_id),
        "github_configured": bool(settings.backup_github_repo and settings.backup_github_token),
        "files": files[:10],
    }


@router.post("/run")
async def run(user: User = Depends(get_current_user)):
    _require_admin(user)
    return await run_backup("manual")


@router.get("/download/{name}")
def download(name: str, user: User = Depends(get_current_user)):
    _require_admin(user)
    if not _ZIP_NAME.match(name):
        raise HTTPException(status_code=422, detail="نام فایل نامعتبر است.")
    path = os.path.join(settings.backup_dir, name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="فایل پشتیبان پیدا نشد.")
    return FileResponse(path, media_type="application/zip", filename=name)
