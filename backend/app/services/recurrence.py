"""Recurrence: when a recurring task is closed, create the next occurrence."""

from datetime import date, timedelta

from sqlalchemy import String, and_
from sqlalchemy import cast as sa_cast
from sqlalchemy.orm import Session

from app.core.timeutils import get_tz, jalali_parts, jalali_month_length
from app.models import Task, Tag, TaskTag, Subtask, User, utcnow


def task_has_recurrence(TaskModel=Task):
    """SQL predicate: the task actually has a recurrence rule.

    JSON columns store Python None as the JSON `null` literal (not SQL NULL),
    so `isnot(None)` alone matches rule-less tasks. Cast to text and exclude
    the JSON null / empty-object renderings (PostgreSQL: json → text cast).
    """
    col_text = sa_cast(TaskModel.recurrence_rule, String)
    return and_(col_text.is_not(None), col_text.notin_(["null", "{}"]))


def compute_next_due(rule: dict, base: date) -> date | None:
    kind = rule.get("kind")
    if kind == "every_n_days":
        n = int(rule.get("n", 1))
        if n <= 0:
            return None
        return base + timedelta(days=n)
    if kind == "weekly":
        weekdays = set(rule.get("weekdays", []))  # Python weekday(): Mon=0 .. Sat=5, Sun=6
        if not weekdays:
            return None
        for i in range(1, 8):
            d = base + timedelta(days=i)
            if d.weekday() in weekdays:
                return d
        return None
    if kind == "monthly_jalali":
        day = int(rule.get("day", 1))
        if not 1 <= day <= 31:
            return None
        jy, jm, jd = jalali_parts(base)
        if day > jd:
            target = (jy, jm)
        else:
            target = (jy + 1, 1) if jm == 12 else (jy, jm + 1)
        clamped = min(day, jalali_month_length(target[0], target[1]))
        import jdatetime

        return jdatetime.date(target[0], target[1], clamped).togregorian()
    return None


def create_next_occurrence(db: Session, user: User, task: Task) -> Task | None:
    rule = task.recurrence_rule
    if not rule:
        return None
    tz = get_tz(user.timezone)
    base = task.due_date
    if base is None:
        from app.core.timeutils import to_utc

        base = to_utc(utcnow()).astimezone(tz).date()
    next_due = compute_next_due(rule, base)
    if next_due is None:
        return None

    clone = Task(
        user_id=user.id,
        area_id=task.area_id,
        project_id=task.project_id,
        title=task.title,
        description=task.description,
        notes="",
        estimate_minutes=task.estimate_minutes,
        priority=task.priority,
        status="backlog",
        due_date=next_due,
        recurrence_rule=rule,
        sort_order=task.sort_order,
    )
    db.add(clone)
    db.flush()
    for st in task.subtasks:
        db.add(Subtask(task_id=clone.id, title=st.title, done=False, sort_order=st.sort_order))
    tag_ids = [link.tag_id for link in task.tag_links]
    if tag_ids:
        db.flush()
        for tid in tag_ids:
            db.add(TaskTag(task_id=clone.id, tag_id=tid))
    db.flush()
    return clone
