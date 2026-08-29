"""Issue-key assignment: retro-key existing tasks when a prefix is set."""

from sqlalchemy import or_, select

from sqlalchemy.orm import Session

from app.models import Area, Project, Task


def assign_missing_keys(db: Session, area: Area) -> None:
    """Give every key-less task under this area (direct or via project) the next
    sequential key, in creation order. Idempotent; called when a prefix is set
    and again at startup as a safety net."""
    if not area.key_prefix:
        return
    project_ids = db.scalars(select(Project.id).where(Project.area_id == area.id)).all()
    conds = [Task.area_id == area.id]
    if project_ids:
        conds.append(Task.project_id.in_(project_ids))
    tasks = db.scalars(select(Task).where(or_(*conds)).order_by(Task.created_at, Task.id)).all()
    n = area.task_counter or 0
    for t in tasks:
        if t.issue_key:
            continue
        n += 1
        t.issue_key = f"{area.key_prefix}-{n:03d}"
    area.task_counter = n
