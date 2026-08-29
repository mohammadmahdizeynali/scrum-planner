"""Daily Telegram notifications:

- Morning briefing (default 06:00 local): tasks in the current sprint with useful
  info per task, plus deadline warnings (overdue / due today / due tomorrow).
- Evening summary (default 23:00 local): what was logged that day, per task.

Reuses the backup Telegram bot when no dedicated notify credentials are set.
Missed daily slots are skipped (no stale briefings); the weekly backup keeps its
own catch-up behavior.
"""

import asyncio
import html
from datetime import datetime, time, timedelta, timezone

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.core.timeutils import (
    fa_digits,
    format_jalali_date,
    get_tz,
    to_utc,
)
from app.models import SprintMembership, Task, TaskStatus, TimeEntry, User, utcnow
from app.services.builders import _task_core_select, build_task_outs
from app.services.sprints import ensure_sprint

_STATUS_ORDER = {"in_progress": 0, "open": 1, "closed": 2, "backlog": 3}
_STATUS_ICON = {"in_progress": "🔄", "open": "▫️", "closed": "✅", "backlog": "▫️"}


def _creds() -> tuple[str, str] | None:
    token = settings.notify_telegram_bot_token or settings.backup_telegram_bot_token
    chat = settings.notify_telegram_chat_id or settings.backup_telegram_chat_id
    return (token, chat) if token and chat else None


def _primary_user(db):
    return db.scalars(select(User).order_by(User.created_at)).first()


def _schedule_tz_name() -> str:
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        user = _primary_user(db)
        return user.timezone if user else settings.default_timezone
    finally:
        db.close()


def next_daily_slot_utc(now_utc: datetime, tz_name: str, hour: int) -> datetime:
    tz = get_tz(tz_name)
    local = now_utc.astimezone(tz)
    slot = datetime.combine(local.date(), time(hour, 0), tzinfo=tz)
    if slot <= local:
        slot += timedelta(days=1)
    return slot.astimezone(timezone.utc)


def fmt_min(minutes: int) -> str:
    m = max(0, int(minutes))
    h = m // 60
    rest = m % 60
    if h == 0:
        return f"{rest} min"
    if rest == 0:
        return f"{h}h"
    return f"{h}h {rest} min"


def _key_html(t) -> str:
    if isinstance(t, dict):
        key = t.get("issue_key") or t.get("key")
    else:
        key = t.issue_key
    return f"<code>{html.escape(key)}</code> — " if key else ""


def _task_line(t: dict, due_label: str | None = None) -> str:
    bits = [_STATUS_ICON.get(t["status"], "▫️"), _key_html(t) + f"<b>{html.escape(t['title'])}</b>"]
    meta = []
    if t["estimate_minutes"]:
        meta.append(f"برآورد {fmt_min(t['estimate_minutes'])}")
    if t["logged_minutes"]:
        meta.append(f"ثبت‌شده {fmt_min(t['logged_minutes'])}")
    if due_label:
        meta.append(due_label)
    if meta:
        bits.append("(" + " · ".join(meta) + ")")
    return "• " + " ".join(bits)


def daily_briefing_text(db, user, now: datetime | None = None) -> str:
    now = to_utc(now or utcnow())
    tz = get_tz(user.timezone)
    today_local = now.astimezone(tz).date()
    sprint = ensure_sprint(db, user, now)

    member_ids = db.scalars(
        select(SprintMembership.task_id).where(SprintMembership.sprint_id == sprint.id)
    ).all()
    tasks = []
    if member_ids:
        rows = db.execute(_task_core_select().where(Task.id.in_(member_ids))).all()
        tasks = build_task_outs(db, rows)
    tasks.sort(key=lambda t: (_STATUS_ORDER.get(t["status"], 9), 0 if t["priority"] == "high" else 1, t["sort_order"]))

    lines = ["☀️ <b>صبح بخیر!</b>", f"📋 <b>{html.escape(sprint.name)}</b> — {fa_digits(len(tasks))} تسک:"]
    if tasks:
        for t in tasks:
            lines.append(_task_line(t))
    else:
        lines.append("اسپرینت این هفته خالی است — از انبار چند تسک اضافه کن.")

    overdue, due_today, due_tomorrow = [], [], []
    for t in db.scalars(
        select(Task).where(
            Task.user_id == user.id,
            Task.status != TaskStatus.closed.value,
            Task.due_date.isnot(None),
        )
    ).all():
        delta = (t.due_date - today_local).days
        if delta < 0:
            overdue.append((t, -delta))
        elif delta == 0:
            due_today.append(t)
        elif delta == 1:
            due_tomorrow.append(t)

    def dead_line(t: Task, label: str) -> str:
        return "  " + _task_line(
            {"issue_key": t.issue_key, "title": t.title, "status": None, "estimate_minutes": None, "logged_minutes": None},
            due_label=label,
        )

    deadline_lines = []
    for t, days in overdue[:10]:
        deadline_lines.append(dead_line(t, f"⚠️ ({fa_digits(days)} روز گذشته)"))
    for t in due_today[:10]:
        deadline_lines.append(dead_line(t, "📅 امروز"))
    for t in due_tomorrow[:10]:
        deadline_lines.append(dead_line(t, "🔜 فردا"))
    if deadline_lines:
        lines.append("")
        lines.append("⏰ <b>مهلت‌ها:</b>")
        lines.extend(deadline_lines)

    open_n = sum(1 for t in tasks if t["status"] in ("open", "in_progress"))
    done_n = sum(1 for t in tasks if t["status"] == "closed")
    lines.append("")
    lines.append(f"💪 {fa_digits(open_n)} تسک پیش‌رو، {fa_digits(done_n)} انجام‌شده. بزن بریم!")
    return "\n".join(lines)


def evening_summary_text(db, user, now: datetime | None = None) -> str:
    now = to_utc(now or utcnow())
    tz = get_tz(user.timezone)
    local_now = now.astimezone(tz)
    day_start = datetime.combine(local_now.date(), time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)

    rows = (
        db.query(TimeEntry, Task)
        .join(Task, Task.id == TimeEntry.task_id)
        .filter(TimeEntry.user_id == user.id, TimeEntry.start_at >= day_start, TimeEntry.start_at < day_end)
        .order_by(TimeEntry.start_at)
        .all()
    )
    total = sum(e.minutes for e, _ in rows)
    lines = [f"🌙 <b>گزارش امروز — {format_jalali_date(local_now.date(), with_weekday=True)}</b>"]

    if not rows:
        lines.append("امروز هیچ زمانی ثبت نشده. با صفحه‌ی ثبت زمان روزت را کامل کن! 📝")
        return "\n".join(lines)

    lines.append(f"⏱ امروز <b>{fmt_min(total)}</b> کار کردی:")
    per_task: dict = {}
    for e, t in rows:
        bucket = per_task.setdefault(t.id, {"title": t.title, "key": t.issue_key, "minutes": 0, "count": 0})
        bucket["minutes"] += e.minutes
        bucket["count"] += 1
    for b in sorted(per_task.values(), key=lambda x: -x["minutes"]):
        key = _key_html(b)
        times = f" ({fa_digits(b['count'])} ثبت)" if b["count"] > 1 else ""
        lines.append(f"• {key}<b>{html.escape(b['title'])}</b> — {fmt_min(b['minutes'])}{times}")
    lines.append(" 🌙 روز خوبی بود؛ استراحت کن!")
    return "\n".join(lines)


# ---------------- delivery + scheduler ----------------

def _chunks(text: str, limit: int = 3900) -> list[str]:
    """Split a message on line boundaries to respect Telegram's 4096-char limit."""
    if len(text) <= limit:
        return [text]
    out: list[str] = []
    buf = ""
    for ln in text.split("\n"):
        if buf and len(buf) + len(ln) + 1 > limit:
            out.append(buf.rstrip("\n"))
            buf = ""
        buf += ln + "\n"
    if buf.strip():
        out.append(buf)
    return out or [text]


async def send_telegram_text(text: str) -> None:
    creds = _creds()
    if creds is None:
        raise RuntimeError("تلگرام تنظیم نشده است.")
    token, chat = creds
    async with httpx.AsyncClient(timeout=60) as client:
        for part in _chunks(text):
            r = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat, "text": part, "parse_mode": "HTML", "disable_web_page_preview": True},
            )
            if not (r.status_code == 200 and r.json().get("ok")):
                raise RuntimeError(f"telegram {r.status_code}: {r.text[:200]}")


async def _send_if_configured(build_text) -> None:
    if _creds() is None:
        print("[notify] skipped: telegram not configured")
        return
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        user = _primary_user(db)
        if user is None:
            return
        text = build_text(db, user)
    finally:
        db.close()
    try:
        await send_telegram_text(text)
    except Exception as e:  # noqa: BLE001 — one failed send must not kill the scheduler
        print(f"[notify] send failed: {e}")


async def notifications_scheduler_loop() -> None:
    while True:
        try:
            tz_name = _schedule_tz_name()
            morning = next_daily_slot_utc(utcnow(), tz_name, settings.notify_morning_hour)
            evening = next_daily_slot_utc(utcnow(), tz_name, settings.notify_evening_hour)
            target, is_morning = (morning, True) if morning <= evening else (evening, False)
            await asyncio.sleep(max(5.0, (target - utcnow()).total_seconds()))
            if is_morning:
                await _send_if_configured(daily_briefing_text)
            else:
                await _send_if_configured(evening_summary_text)
        except Exception as e:  # noqa: BLE001 — the scheduler must never crash the app
            print(f"[notify] scheduler error: {e}")
            await asyncio.sleep(600)
