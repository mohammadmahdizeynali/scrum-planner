"""Time and Jalali calendar helpers — the single source of truth for bucketing.

Conventions (see glossary.md):
- Everything is stored as timezone-aware UTC datetimes.
- Weeks run Saturday 00:00 → Friday 24:00 in the USER's timezone.
- Python weekday(): Mon=0 .. Sat=5, Sun=6. Saturday = 5.
- Display strings use Jalali dates with Persian digits.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import jdatetime

from app.core.config import settings

PERSIAN_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")

JALALI_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]

JALALI_WEEKDAYS = ["شنبه", "یک‌شنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"]


def get_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or settings.default_timezone)
    except Exception:
        return ZoneInfo(settings.default_timezone)


def fa_digits(value) -> str:
    return str(value).translate(PERSIAN_DIGITS)


def to_utc(dt: datetime) -> datetime:
    """Normalize any datetime (naive interpreted as UTC) to aware UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def week_start_utc(at: datetime, tz_name: str | None) -> datetime:
    """Saturday 00:00 of the week containing `at`, in the given timezone, as UTC."""
    tz = get_tz(tz_name)
    local = to_utc(at).astimezone(tz)
    days_since_saturday = (local.weekday() - 5) % 7
    d = local.date() - timedelta(days=days_since_saturday)
    return datetime.combine(d, time(0, 0), tzinfo=tz).astimezone(timezone.utc)


def week_dates(at: datetime, tz_name: str | None) -> list[date]:
    """The 7 local dates of the week (Saturday .. Friday)."""
    tz = get_tz(tz_name)
    start_local = week_start_utc(at, tz_name).astimezone(tz).date()
    return [start_local + timedelta(days=i) for i in range(7)]


def is_saturday(d: date) -> bool:
    return d.weekday() == 5


def jalali_parts(d: date) -> tuple[int, int, int]:
    j = jdatetime.date.fromgregorian(date=d)
    return j.year, j.month, j.day


def jalali_weekday_index(d: date) -> int:
    """0 = Saturday .. 6 = Friday."""
    return (d.weekday() - 5) % 7


def format_jalali_date(d: date, *, with_weekday: bool = False, with_year: bool = True) -> str:
    jy, jm, jd = jalali_parts(d)
    s = f"{fa_digits(jd)} {JALALI_MONTHS[jm - 1]}"
    if with_year:
        s += f" {fa_digits(jy)}"
    if with_weekday:
        s = f"{JALALI_WEEKDAYS[jalali_weekday_index(d)]} {s}"
    return s


def sprint_label(week_start: datetime, tz_name: str | None) -> str:
    """«اسپرینت ۳۱ مرداد تا ۶ شهریور ۱۴۰۵» — range across the Sat..Fri local dates."""
    tz = get_tz(tz_name)
    start_d = week_start.astimezone(tz).date()
    end_d = start_d + timedelta(days=6)
    sy, sm, sd = jalali_parts(start_d)
    ey, em, ed = jalali_parts(end_d)
    if (sy, sm) == (ey, em):
        first = fa_digits(sd)
    elif sy == ey:
        first = f"{fa_digits(sd)} {JALALI_MONTHS[sm - 1]}"
    else:
        first = format_jalali_date(start_d)
    return f"اسپرینت {first} تا {fa_digits(ed)} {JALALI_MONTHS[em - 1]} {fa_digits(ey)}"


def jalali_month_range(jy: int, jm: int, tz_name: str | None) -> tuple[datetime, datetime]:
    """UTC start/end of a Jalali month [1st 00:00, next month 1st 00:00) in user TZ."""
    tz = get_tz(tz_name)
    start_g = jdatetime.date(jy, jm, 1).togregorian()
    if jm == 12:
        next_g = jdatetime.date(jy + 1, 1, 1).togregorian()
    else:
        next_g = jdatetime.date(jy, jm + 1, 1).togregorian()
    start = datetime.combine(start_g, time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(next_g, time(0, 0), tzinfo=tz).astimezone(timezone.utc)
    return start, end


def jalali_month_of(dt_utc: datetime, tz_name: str | None) -> tuple[int, int]:
    tz = get_tz(tz_name)
    local_date = to_utc(dt_utc).astimezone(tz).date()
    jy, jm, _ = jalali_parts(local_date)
    return jy, jm


def jalali_month_length(jy: int, jm: int) -> int:
    if jm == 12:
        next_g = jdatetime.date(jy + 1, 1, 1).togregorian()
    else:
        next_g = jdatetime.date(jy, jm + 1, 1).togregorian()
    last_day = jdatetime.date(jy, jm, 1).togregorian()
    return (next_g - last_day).days


def jalali_month_label(jy: int, jm: int) -> str:
    return f"{JALALI_MONTHS[jm - 1]} {fa_digits(jy)}"


def jalali_month_start_utc_months_ago(now_utc: datetime, months: int, tz_name: str | None) -> datetime:
    """Start (00:00 local) of the Jalali month `months` before the current one —
    e.g. months=3 in Shahrivar → 1 Khordad 00:00. Used as the archive-retention cutoff."""
    tz = get_tz(tz_name)
    local_date = to_utc(now_utc).astimezone(tz).date()
    jy, jm, _ = jalali_parts(local_date)
    m = jm - months
    y = jy
    while m <= 0:
        m += 12
        y -= 1
    g = jdatetime.date(y, m, 1).togregorian()
    return datetime.combine(g, time(0, 0), tzinfo=tz).astimezone(timezone.utc)
