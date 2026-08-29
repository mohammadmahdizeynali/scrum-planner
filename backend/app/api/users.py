from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db import get_db
from app.deps import get_current_user
from app.models import User
from app.schemas import PasswordChangeIn, UserOut, UserUpdateIn

router = APIRouter(prefix="/users", tags=["users"])


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.timezone is not None:
        try:
            from zoneinfo import ZoneInfo

            ZoneInfo(body.timezone)
        except Exception:
            raise HTTPException(status_code=422, detail="منطقه زمانی نامعتبر است.")
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
