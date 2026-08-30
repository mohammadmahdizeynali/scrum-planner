from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import resolve_session_token
from app.db import get_db
from app.models import User


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="ابتدا وارد شوید.")
    resolved = resolve_session_token(db, token)
    if resolved is None:
        raise HTTPException(status_code=401, detail="نشست شما منقضی شده است.")
    _session, user = resolved
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="این بخش فقط برای مدیر سیستم است.")
    return user
