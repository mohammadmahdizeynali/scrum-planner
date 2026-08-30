import hashlib
import ipaddress
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings

_hasher = PasswordHasher()

_login_attempts: dict[str, deque[float]] = defaultdict(deque)
_login_lock = threading.Lock()
_LOGIN_WINDOW_SECONDS = 60
_LOGIN_MAX_ATTEMPTS = 5


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        _hasher.verify(password_hash, password)
        return True
    except VerifyMismatchError:
        return False


def check_login_rate_limit(ip: str, username: str) -> None:
    key = f"{ip}:{username}"
    now = time.monotonic()
    with _login_lock:
        attempts = _login_attempts[key]
        while attempts and now - attempts[0] > _LOGIN_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
            raise HTTPException(status_code=429, detail="تلاش‌های ناموفق زیاد است؛ کمی بعد دوباره امتحان کنید.")
        attempts.append(now)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        try:
            return str(ipaddress.ip_address(first))
        except ValueError:
            pass
    return request.client.host if request.client else "unknown"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user_id) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days)
    from app.models import Session as SessionRow

    db.add(SessionRow(user_id=user_id, token_hash=_hash_token(token), expires_at=expires))
    db.commit()
    return token


def resolve_session_token(db: Session, token: str):
    """Return (session, user) for a valid, unexpired token; extend sliding expiry."""
    from app.models import Session as SessionRow
    from app.models import User

    row = db.scalar(select(SessionRow).where(SessionRow.token_hash == _hash_token(token)))
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    if row.expires_at.replace(tzinfo=timezone.utc) < now:
        db.delete(row)
        db.commit()
        return None
    # Sliding expiry: extend when less than half the TTL remains.
    threshold = now + timedelta(days=settings.session_ttl_days / 2)
    if row.expires_at.replace(tzinfo=timezone.utc) < threshold:
        row.expires_at = now + timedelta(days=settings.session_ttl_days)
        db.commit()
    user = db.get(User, row.user_id)
    return (row, user) if user else None


def destroy_session(db: Session, token: str) -> None:
    from app.models import Session as SessionRow

    row = db.scalar(select(SessionRow).where(SessionRow.token_hash == _hash_token(token)))
    if row:
        db.delete(row)
        db.commit()

def revoke_user_sessions(db: Session, user_id) -> None:
    """Drop every session of a user (password reset / deactivation / account removal)."""
    from app.models import Session as SessionRow

    for row in db.scalars(select(SessionRow).where(SessionRow.user_id == user_id)).all():
        db.delete(row)
    db.commit()
