"""Issue-key assignment: area, project, and subproject prefixes → task keys.

Resolution chain for a task's key prefix:
    direct project → parent project (for prefix-less subprojects) → area

Prefixes share one namespace (validated at the API layer) so generated keys
like ``SBU-001`` and ``MCDA-001`` never collide.
"""

from sqlalchemy import or_, select

from sqlalchemy.orm import Session

from app.models import Area, Project, Task


def effective_key_holder(db: Session, project: Project | None) -> Project | None:
    """The project whose prefix generates keys for a task under `project`.

    Walks up one level for prefix-less subprojects; None if the whole project
    chain is prefix-less (the caller falls back to the area).
    """
    p = project
    while p is not None:
        if p.key_prefix:
            return p
        p = db.get(Project, p.parent_project_id) if p.parent_project_id else None
    return None


def next_key(db: Session, holder: Area | Project) -> str:
    """Consume the holder's counter and return its next task key."""
    holder.task_counter = (holder.task_counter or 0) + 1
    return f"{holder.key_prefix}-{holder.task_counter:03d}"


def assign_missing_keys(db: Session, area: Area) -> None:
    """Give every key-less task that resolves to this area's prefix the next
    sequential key, in creation order. Idempotent; called when a prefix is set
    and again at startup as a safety net."""
    if not area.key_prefix:
        return
    projects = db.scalars(select(Project).where(Project.area_id == area.id)).all()
    area_keyed_project_ids = [
        p.id for p in projects if effective_key_holder(db, p) is None
    ]
    conds = [Task.area_id == area.id]
    if area_keyed_project_ids:
        conds.append(Task.project_id.in_(area_keyed_project_ids))
    tasks = db.scalars(select(Task).where(or_(*conds)).order_by(Task.created_at, Task.id)).all()
    n = area.task_counter or 0
    for t in tasks:
        if t.issue_key:
            continue
        n += 1
        t.issue_key = f"{area.key_prefix}-{n:03d}"
    area.task_counter = n


def assign_missing_project_keys(db: Session, project: Project) -> None:
    """Give every key-less task under this project (directly or under its own
    prefix-less subprojects) the project's next sequential key."""
    if not project.key_prefix:
        return
    sub_ids = [
        s.id
        for s in db.scalars(select(Project).where(Project.parent_project_id == project.id)).all()
        if s.key_prefix is None
    ]
    conds = [Task.project_id == project.id]
    if sub_ids:
        conds.append(Task.project_id.in_(sub_ids))
    tasks = db.scalars(select(Task).where(or_(*conds)).order_by(Task.created_at, Task.id)).all()
    n = project.task_counter or 0
    for t in tasks:
        if t.issue_key:
            continue
        n += 1
        t.issue_key = f"{project.key_prefix}-{n:03d}"
    project.task_counter = n
