import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Area, Project, Task, TimeEntry, User, utcnow
from app.schemas import AreaIn, AreaOut, AreaUpdateIn, DeletePreviewOut, ProjectIn, ProjectOut, ProjectUpdateIn
from app.services.issue_keys import assign_missing_keys, assign_missing_project_keys

router = APIRouter(tags=["structure"])

# Issue keys: 2–5 Latin chars, start with a letter — one namespace across
# areas and projects so generated task keys (SBU-001 / MCDA-001) never collide.
_KEY_PREFIX_RE = re.compile(r"^[A-Z][A-Z0-9]{1,4}$")


def _area_counts(db: Session, user: User):
    project_counts = dict(
        db.query(Project.area_id, func.count())
        .filter(Project.user_id == user.id)
        .group_by(Project.area_id)
        .all()
    )
    area_task_counts = dict(
        db.query(Task.area_id, func.count())
        .filter(Task.user_id == user.id, Task.area_id.isnot(None))
        .group_by(Task.area_id)
        .all()
    )
    project_task_counts = dict(
        db.query(Project.area_id, func.count(Task.id))
        .outerjoin(Task, Task.project_id == Project.id)
        .filter(Project.user_id == user.id)
        .group_by(Project.area_id)
        .all()
    )
    return project_counts, area_task_counts, project_task_counts


def _normalize_prefix(value: str | None) -> str | None:
    if value is None:
        return None
    kp = value.strip().upper()
    if not _KEY_PREFIX_RE.match(kp):
        raise HTTPException(
            status_code=422,
            detail="کلید باید ۲ تا ۵ نویسه لاتین باشد و با حرف شروع شود (مثلا SBU یا MCDA).",
        )
    return kp


def _ensure_prefix_free(db: Session, kp: str, exclude_area_id=None, exclude_project_id=None) -> None:
    """Prefixes share one namespace across areas and projects."""
    area_taken = db.scalar(
        select(func.count()).select_from(Area).where(Area.key_prefix == kp, Area.id != exclude_area_id)
    )
    project_taken = db.scalar(
        select(func.count()).select_from(Project).where(
            Project.key_prefix == kp, Project.id != exclude_project_id
        )
    )
    if int(area_taken or 0) > 0 or int(project_taken or 0) > 0:
        raise HTTPException(status_code=409, detail="این کلید قبلاً برای مسیر یا پروژهٔ دیگری استفاده شده است.")


def _build_area_out(db: Session, area: Area, user: User) -> AreaOut:
    project_counts, area_tasks, project_tasks = _area_counts(db, user)
    return AreaOut(
        id=area.id,
        name=area.name,
        color=area.color,
        billable_default=area.billable_default,
        key_prefix=area.key_prefix,
        default_task_type=area.default_task_type,
        sort_order=area.sort_order,
        project_count=project_counts.get(area.id, 0),
        task_count=area_tasks.get(area.id, 0) + project_tasks.get(area.id, 0),
    )


@router.get("/areas", response_model=list[AreaOut])
def list_areas(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_counts, area_tasks, project_tasks = _area_counts(db, user)
    areas = db.scalars(select(Area).where(Area.user_id == user.id).order_by(Area.sort_order, Area.created_at)).all()
    return [
        AreaOut(
            id=a.id,
            name=a.name,
            color=a.color,
            billable_default=a.billable_default,
            key_prefix=a.key_prefix,
            default_task_type=a.default_task_type,
            sort_order=a.sort_order,
            project_count=project_counts.get(a.id, 0),
            task_count=area_tasks.get(a.id, 0) + project_tasks.get(a.id, 0),
        )
        for a in areas
    ]


@router.post("/areas", response_model=AreaOut)
def create_area(body: AreaIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    data = body.model_dump()
    kp = _normalize_prefix(data.pop("key_prefix", None))
    if kp is not None:
        _ensure_prefix_free(db, kp)
    area = Area(user_id=user.id, key_prefix=kp, **data)
    db.add(area)
    db.commit()
    db.refresh(area)
    return _build_area_out(db, area, user)


def _get_area(db, user, area_id) -> Area:
    area = db.get(Area, area_id)
    if area is None or area.user_id != user.id:
        raise HTTPException(status_code=404, detail="مسیر پیدا نشد.")
    return area


@router.patch("/areas/{area_id}", response_model=AreaOut)
def update_area(area_id: uuid.UUID, body: AreaUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    area = _get_area(db, user, area_id)
    data = body.model_dump(exclude_unset=True)
    if "key_prefix" in data:
        kp = _normalize_prefix(data["key_prefix"])
        if kp != area.key_prefix:
            keyed = db.query(func.count(Task.id)).filter(Task.issue_key.ilike(f"{area.key_prefix or ''}-%")).scalar()
            if area.key_prefix and int(keyed or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="این مسیر تسک با کلید دارد؛ پیشوند برای حفظ هویت کلیدها قابل تغییر نیست.",
                )
            if kp is not None:
                _ensure_prefix_free(db, kp, exclude_area_id=area.id)
            data["key_prefix"] = kp
            if kp is None:
                area.task_counter = 0
        else:
            data.pop("key_prefix")
    for field, value in data.items():
        setattr(area, field, value)
    if area.key_prefix:
        assign_missing_keys(db, area)
    db.commit()
    db.refresh(area)
    return _build_area_out(db, area, user)


def _area_delete_preview(db, user, area: Area) -> DeletePreviewOut:
    project_ids = [p.id for p in db.scalars(select(Project).where(Project.area_id == area.id)).all()]
    conds = [Task.area_id == area.id]
    if project_ids:
        conds.append(Task.project_id.in_(project_ids))
    tasks = db.scalars(select(Task).where(or_(*conds))).all()
    minutes = 0
    entry_count = 0
    if tasks:
        minutes = db.query(func.coalesce(func.sum(TimeEntry.minutes), 0)).filter(TimeEntry.task_id.in_([t.id for t in tasks])).scalar()
        entry_count = db.query(func.count()).select_from(TimeEntry).filter(TimeEntry.task_id.in_([t.id for t in tasks])).scalar()
    return DeletePreviewOut(projects=len(project_ids), tasks=len(tasks), time_entries=entry_count, logged_minutes=int(minutes or 0))


@router.get("/areas/{area_id}/delete-preview", response_model=DeletePreviewOut)
def area_delete_preview(area_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _area_delete_preview(db, user, _get_area(db, user, area_id))


@router.delete("/areas/{area_id}")
def delete_area(
    area_id: uuid.UUID,
    mode: str = Query(..., pattern="^(move|purge)$"),
    target_area_id: uuid.UUID | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    area = _get_area(db, user, area_id)
    if mode == "move":
        if target_area_id is None:
            raise HTTPException(status_code=422, detail="مسیر مقصد را انتخاب کنید.")
        target = _get_area(db, user, target_area_id)
        if target.id == area.id:
            raise HTTPException(status_code=422, detail="مسیر مقصد باید متفاوت باشد.")
        for p in db.scalars(select(Project).where(Project.area_id == area.id)).all():
            p.area_id = target.id
        for t in db.scalars(select(Task).where(Task.area_id == area.id)).all():
            t.area_id = target.id
    db.delete(area)
    db.commit()
    return {"ok": True}


# ---------------- Projects / Subprojects ----------------

def _project_out(db, p: Project) -> ProjectOut:
    count = db.query(func.count(Task.id)).filter(Task.project_id == p.id).scalar()
    return ProjectOut(
        id=p.id,
        area_id=p.area_id,
        name=p.name,
        color=p.color,
        parent_project_id=p.parent_project_id,
        key_prefix=p.key_prefix,
        default_task_type=p.default_task_type,
        closed_at=p.closed_at,
        sort_order=p.sort_order,
        task_count=int(count or 0),
    )


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    area_id: uuid.UUID | None = None,
    include_closed: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Project).where(Project.user_id == user.id)
    if area_id is not None:
        q = q.where(Project.area_id == area_id)
    if not include_closed:
        q = q.where(Project.closed_at.is_(None))
    projects = db.scalars(q.order_by(Project.sort_order, Project.created_at)).all()
    return [_project_out(db, p) for p in projects]


@router.post("/projects", response_model=ProjectOut)
def create_project(body: ProjectIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    area = db.get(Area, body.area_id)
    if area is None or area.user_id != user.id:
        raise HTTPException(status_code=404, detail="مسیر پیدا نشد.")
    data = body.model_dump()
    if data.get("parent_project_id") is not None:
        parent = db.get(Project, data["parent_project_id"])
        if parent is None or parent.user_id != user.id:
            raise HTTPException(status_code=404, detail="پروژهٔ والد پیدا نشد.")
        if parent.parent_project_id is not None:
            raise HTTPException(status_code=422, detail="زیرسطح‌بندی بیشتر از یک سطح ممکن نیست (مسیر ← پروژه ← زیرپروژه).")
    kp = _normalize_prefix(data.get("key_prefix"))
    if kp is not None:
        _ensure_prefix_free(db, kp)
    data["key_prefix"] = kp
    project = Project(user_id=user.id, **data)
    db.add(project)
    db.commit()
    db.refresh(project)
    if project.key_prefix:
        assign_missing_project_keys(db, project)
        db.commit()
    return _project_out(db, project)


def _get_project(db, user, project_id) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status_code=404, detail="پروژه پیدا نشد.")
    return project


@router.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: uuid.UUID, body: ProjectUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_project(db, user, project_id)
    data = body.model_dump(exclude_unset=True)
    if "area_id" in data and data["area_id"] is not None:
        new_area = db.get(Area, data["area_id"])
        if new_area is None or new_area.user_id != user.id:
            raise HTTPException(status_code=404, detail="مسیر پیدا نشد.")
    if "key_prefix" in data:
        kp = _normalize_prefix(data["key_prefix"])
        if kp != project.key_prefix:
            keyed = db.query(func.count(Task.id)).filter(Task.issue_key.ilike(f"{project.key_prefix or ''}-%")).scalar()
            if project.key_prefix and int(keyed or 0) > 0:
                raise HTTPException(
                    status_code=409,
                    detail="این پروژه تسک با کلید دارد؛ کلید برای حفظ هویت (مثل MCDA-001) قابل تغییر نیست.",
                )
            if kp is not None:
                _ensure_prefix_free(db, kp, exclude_project_id=project.id)
            data["key_prefix"] = kp
            if kp is None:
                project.task_counter = 0
        else:
            data.pop("key_prefix")
    for field, value in data.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    if project.key_prefix:
        assign_missing_project_keys(db, project)
        db.commit()
        db.refresh(project)
    return _project_out(db, project)


@router.post("/projects/{project_id}/close", response_model=ProjectOut)
def close_project(project_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Close a project (or subproject) — it disappears from the active lists
    but stays available for history."""
    project = _get_project(db, user, project_id)
    if project.closed_at is None:
        project.closed_at = utcnow()
        db.commit()
        db.refresh(project)
    return _project_out(db, project)


@router.post("/projects/{project_id}/reopen", response_model=ProjectOut)
def reopen_project(project_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_project(db, user, project_id)
    project.closed_at = None
    db.commit()
    db.refresh(project)
    return _project_out(db, project)


@router.get("/projects/{project_id}/delete-preview", response_model=DeletePreviewOut)
def project_delete_preview(project_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = _get_project(db, user, project_id)
    tasks = db.scalars(select(Task).where(Task.project_id == project.id)).all()
    minutes, entry_count = 0, 0
    if tasks:
        ids = [t.id for t in tasks]
        minutes = db.query(func.coalesce(func.sum(TimeEntry.minutes), 0)).filter(TimeEntry.task_id.in_(ids)).scalar()
        entry_count = db.query(func.count()).select_from(TimeEntry).filter(TimeEntry.task_id.in_(ids)).scalar()
    return DeletePreviewOut(projects=0, tasks=len(tasks), time_entries=entry_count, logged_minutes=int(minutes or 0))


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: uuid.UUID,
    mode: str = Query(..., pattern="^(move|purge)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = _get_project(db, user, project_id)
    if mode == "move":
        # Subprojects are promoted to top-level projects under the same area.
        for sub in db.scalars(select(Project).where(Project.parent_project_id == project.id)).all():
            sub.parent_project_id = None
        for t in db.scalars(select(Task).where(Task.project_id == project.id)).all():
            t.project_id = None
            t.area_id = project.area_id
    db.delete(project)
    db.commit()
    return {"ok": True}
