import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, revoke_user_sessions, verify_password
from app.db import get_db
from app.deps import get_current_user, require_admin
from app.models import User
from app.schemas import (
    PasswordChangeIn,
    UserAdminCreateIn,
    UserAdminOut,
    UserAdminUpdateIn,
    UserOut,
    UserUpdateIn,
)

router = APIRouter(prefix="/users", tags=["users"])

_USERNAME_RE = re.compile(r"^\S+$")


def _validate_timezone(tz: str) -> None:
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo(tz)
    except Exception:
        raise HTTPException(status_code=422, detail="منطقه زمانی نامعتبر است.")


def _normalize_username(raw: str) -> str:
    username = raw.strip().lower()
    if not _USERNAME_RE.match(username):
        raise HTTPException(status_code=422, detail="نام کاربری نمی‌تواند فاصله داشته باشد.")
    if len(username) < 3:
        raise HTTPException(status_code=422, detail="نام کاربری باید حداقل ۳ نویسه باشد.")
    return username


# ---------- self service ----------


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.timezone is not None:
        _validate_timezone(body.timezone)
        user.timezone = body.timezone
    if body.theme is not None:
        user.theme = body.theme
    db.commit()
    db.refresh(user)
    return user


@router.put("/me/password")
def change_password(
    body: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="رمز عبور فعلی اشتباه است.")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


# ---------- admin: user management ----------
# The admin manages accounts only — other users' workspaces stay fully private.


@router.get("", response_model=list[UserAdminOut])
def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.created_at, User.username)).all()


@router.post("", response_model=UserAdminOut, status_code=201)
def create_user(body: UserAdminCreateIn, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    username = _normalize_username(body.username)
    _validate_timezone(body.timezone)
    exists = db.scalar(
        select(func.count()).select_from(User).where(func.lower(User.username) == username)
    )
    if exists:
        raise HTTPException(status_code=409, detail="این نام کاربری قبلاً گرفته شده است.")
    user = User(
        username=username,
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
        timezone=body.timezone,
        role="member",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserAdminOut)
def update_user(
    user_id: uuid.UUID,
    body: UserAdminUpdateIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد.")
    if user.role == "admin" and user.id != admin.id:
        raise HTTPException(status_code=403, detail="ویرایش حساب مدیر ممکن نیست.")
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.timezone is not None:
        _validate_timezone(body.timezone)
        user.timezone = body.timezone
    revoke = False
    if body.is_active is not None:
        if user.id == admin.id and not body.is_active:
            raise HTTPException(status_code=400, detail="نمی‌توانید حساب خودتان را غیرفعال کنید.")
        if user.is_active and not body.is_active:
            revoke = True
        user.is_active = body.is_active
    if body.new_password is not None:
        user.password_hash = hash_password(body.new_password)
        revoke = True
    db.commit()
    if revoke:
        revoke_user_sessions(db, user.id)
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد.")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="نمی‌توانید حساب خودتان را حذف کنید.")
    if user.role == "admin":
        raise HTTPException(status_code=403, detail="حذف حساب مدیر ممکن نیست.")
    # All of the user's areas/tasks/sprints/entries disappear with them (FK CASCADE).
    revoke_user_sessions(db, user.id)
    db.delete(user)
    db.commit()
    return {"ok": True}
