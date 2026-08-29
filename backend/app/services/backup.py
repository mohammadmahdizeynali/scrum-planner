"""Backup pipeline: PostgreSQL dump → ZIP (db + .env + compose files + restore kit)
→ deliver to Telegram and/or a private GitHub repo. Used by both the manual
Settings button and the automatic weekly scheduler (Saturday 02:00, admin TZ).
"""

import asyncio
import base64
import io
import os
import subprocess
import zipfile
from datetime import datetime, time, timedelta, timezone
from urllib.parse import unquote, urlparse

import anyio
import httpx

from app.core.config import settings
from app.core.timeutils import get_tz

BACKUP_MARKER = "last_auto.txt"

RESTORE_SH = """#!/bin/sh
# Restore the planner from a backup ZIP on a (new) server.
# Usage: sh restore.sh planner-backup-YYYYMMDD-HHMM.zip
set -e
ZIP="$1"
[ -f "$ZIP" ] || { echo "file not found: $ZIP"; exit 1; }
command -v unzip >/dev/null 2>&1 || { echo "install unzip first (apt install unzip)"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "install Docker + Compose first"; exit 1; }

rm -rf .restore_tmp && mkdir .restore_tmp
unzip -o "$ZIP" -d .restore_tmp >/dev/null

# Config files: existing ones win, missing ones come from the backup.
[ -f .env ] || { [ -f .restore_tmp/.env ] && cp .restore_tmp/.env .env && echo ".env restored"; }
[ -f compose.yml ] || { [ -f .restore_tmp/compose.yml ] && cp .restore_tmp/compose.yml compose.yml && echo "compose.yml restored"; }
[ -d docker ] || { [ -d .restore_tmp/docker ] && cp -r .restore_tmp/docker docker && echo "docker/ restored"; }

[ -f .env ] || { echo "WARNING: no .env found — create one from .env.example first"; }
set -a; . ./.env 2>/dev/null; set +a

docker compose up -d postgres
echo "waiting for postgres..."
sleep 8
docker compose exec -T postgres psql -U "${POSTGRES_USER:-planner}" -d "${POSTGRES_DB:-planner}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-planner}" -d "${POSTGRES_DB:-planner}" -v ON_ERROR_STOP=1 -q < .restore_tmp/db.sql
docker compose up -d
rm -rf .restore_tmp
echo "Restore complete. Open the app in your browser and log in."
"""

RESTORE_MD = """# بازیابی برنامه‌ریز از این فایل پشتیبان

این فایل شامل همه‌چیز برای بازگرداندن کامل برنامه روی یک سرور جدید است:
`db.sql` (کل داده‌ها)، `.env` (تنظیمات و رمزها)، `compose.yml` و `docker/` و اسکریپت `restore.sh`.

## مراحل روی سرور جدید

1. Docker و Docker Compose نصب باشد.
2. اگر مخزن خصوصی گیت‌هاب را دارید:
   `git clone <repo-url> planner && cd planner`
   وگرنه از همین zip فقط فایل‌های `compose.yml` و پوشه `docker/` را در یک پوشه خالی کپی کنید.
3. اگر فایل `.env` در آن پوشه نیست، از داخل همین zip کپی کنید.
4. اجرای بازیابی:
   `sh restore.sh planner-backup-XXXXXX.zip`
5. منتظر بمانید تا پیام «Restore complete» ظاهر شود؛ برنامه روی همان دامنه/پورت بالا می‌آید
   و همه حوزه‌ها، پروژه‌ها، تسک‌ها، اسپرینت‌ها، ثبت زمان‌ها و گزارش‌ها سر جای‌شان هستند.
"""


def _db_conn_info() -> dict:
    raw = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    u = urlparse(raw)
    return {
        "host": u.hostname or "postgres",
        "port": u.port or 5432,
        "user": unquote(u.username or "planner"),
        "password": unquote(u.password or ""),
        "db": (u.path or "/planner").lstrip("/"),
    }


def build_dump() -> bytes:
    info = _db_conn_info()
    env = {**os.environ, "PGPASSWORD": info["password"]}
    proc = subprocess.run(
        [
            "pg_dump", "-h", info["host"], "-p", str(info["port"]),
            "-U", info["user"], "-d", info["db"],
            "--no-owner", "--no-privileges",
        ],
        env=env,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {proc.stderr.decode(errors='replace')[:400]}")
    return proc.stdout


def _build_zip_sync() -> tuple[bytes, str]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    name = f"planner-backup-{stamp}.zip"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("db.sql", build_dump())
        z.writestr("restore.sh", RESTORE_SH)
        z.writestr("RESTORE.md", RESTORE_MD)
        for path, arc in ((settings.env_file_path, ".env"), (settings.compose_file_path, "compose.yml")):
            if os.path.isfile(path):
                z.write(path, arc)
        if os.path.isdir(settings.docker_dir_path):
            for root, _, files in os.walk(settings.docker_dir_path):
                for f in files:
                    full = os.path.join(root, f)
                    arc = os.path.join("docker", os.path.relpath(full, settings.docker_dir_path))
                    z.write(full, arc)
    return buf.getvalue(), name


def _save_local(data: bytes, name: str) -> None:
    os.makedirs(settings.backup_dir, exist_ok=True)
    with open(os.path.join(settings.backup_dir, name), "wb") as f:
        f.write(data)
    zips = sorted(
        (f for f in os.listdir(settings.backup_dir) if f.endswith(".zip")),
        reverse=True,
    )
    for old in zips[settings.backup_keep_local:]:
        try:
            os.remove(os.path.join(settings.backup_dir, old))
        except OSError:
            pass


async def _send_telegram(data: bytes, name: str, caption: str) -> None:
    url = f"https://api.telegram.org/bot{settings.backup_telegram_bot_token}/sendDocument"
    files = {"document": (name, data, "application/zip")}
    form = {"chat_id": settings.backup_telegram_chat_id, "caption": caption}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(url, data=form, files=files)
    if not (r.status_code == 200 and r.json().get("ok")):
        raise RuntimeError(f"telegram {r.status_code}: {r.text[:200]}")


async def _send_github(data: bytes, name: str) -> None:
    api = f"https://api.github.com/repos/{settings.backup_github_repo}/contents/backups/{name}"
    headers = {
        "Authorization": f"Bearer {settings.backup_github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    payload = {"message": f"backup: {name}", "content": base64.b64encode(data).decode()}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.put(api, json=payload, headers=headers)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"github {r.status_code}: {r.text[:200]}")


async def run_backup(trigger: str) -> dict:
    """Build the ZIP, keep it locally, deliver to every configured channel."""
    data, name = await anyio.to_thread.run_sync(_build_zip_sync)
    _save_local(data, name)

    deliveries = []
    if settings.backup_telegram_bot_token and settings.backup_telegram_chat_id:
        deliveries.append(await _attempt("telegram", _send_telegram(data, name, f"پشتیبان برنامه‌ریز — {name} ({trigger})")))
    else:
        deliveries.append({"channel": "telegram", "ok": None, "detail": "تنظیم نشده است"})
    if settings.backup_github_repo and settings.backup_github_token:
        deliveries.append(await _attempt("github", _send_github(data, name)))
    else:
        deliveries.append({"channel": "github", "ok": None, "detail": "تنظیم نشده است"})

    if trigger == "auto":
        marker = os.path.join(settings.backup_dir, BACKUP_MARKER)
        os.makedirs(settings.backup_dir, exist_ok=True)
        with open(marker, "w") as f:
            f.write(datetime.now(timezone.utc).isoformat())
    return {"name": name, "size": len(data), "trigger": trigger, "deliveries": deliveries}


async def _attempt(channel: str, coro) -> dict:
    try:
        await coro
        return {"channel": channel, "ok": True, "detail": "ارسال شد"}
    except Exception as e:  # noqa: BLE001 — one channel failing must not abort the other
        return {"channel": channel, "ok": False, "detail": str(e)[:300]}


# ---------------- scheduling (Saturday 02:00, admin timezone) ----------------

def next_backup_slot_utc(now_utc: datetime, tz_name: str) -> datetime:
    tz = get_tz(tz_name)
    local = now_utc.astimezone(tz)
    days_ahead = (5 - local.weekday()) % 7  # Saturday = 5
    d = (local + timedelta(days=days_ahead)).date()
    slot = datetime.combine(d, time(2, 0), tzinfo=tz)
    if slot <= local:
        slot += timedelta(days=7)
    return slot.astimezone(timezone.utc)


def prev_backup_slot_utc(now_utc: datetime, tz_name: str) -> datetime:
    return next_backup_slot_utc(now_utc - timedelta(days=7) - timedelta(minutes=1), tz_name)


def _marker_path() -> str:
    return os.path.join(settings.backup_dir, BACKUP_MARKER)


def _last_auto_marker() -> datetime | None:
    try:
        with open(_marker_path()) as f:
            return datetime.fromisoformat(f.read().strip())
    except Exception:
        return None


def _schedule_tz() -> str:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User

    db = SessionLocal()
    try:
        user = db.scalars(select(User).order_by(User.created_at)).first()
        return user.timezone if user else settings.default_timezone
    finally:
        db.close()


async def backup_scheduler_loop() -> None:
    """Catch up if a Saturday slot was missed, then run every Saturday 02:00 (admin TZ)."""
    while True:
        try:
            tz_name = _schedule_tz()
            now = datetime.now(timezone.utc)
            last_slot = prev_backup_slot_utc(now, tz_name)
            marker = _last_auto_marker()
            if marker is None or marker < last_slot:
                await run_backup("auto")
        except Exception as e:  # noqa: BLE001 — the scheduler must never crash the app
            print(f"[backup] scheduled run failed: {e}")
        try:
            tz_name = _schedule_tz()
            nxt = next_backup_slot_utc(datetime.now(timezone.utc), tz_name)
            await asyncio.sleep(max(5.0, (nxt - datetime.now(timezone.utc)).total_seconds()))
        except Exception as e:  # noqa: BLE001
            print(f"[backup] scheduler sleep failed: {e}")
            await asyncio.sleep(3600)
