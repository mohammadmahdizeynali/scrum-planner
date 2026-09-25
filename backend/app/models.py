import enum
import uuid
from datetime import date, datetime, time, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class TaskStatus(str, enum.Enum):
    backlog = "backlog"
    open = "open"
    in_progress = "in_progress"
    closed = "closed"


class TaskType(str, enum.Enum):
    todo = "todo"          # only completion matters — no time logging
    timed = "timed"        # duration and details matter — logs, estimates, timesheet


class TaskPriority(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"


class SprintStatus(str, enum.Enum):
    active = "active"
    closed = "closed"


class MembershipSource(str, enum.Enum):
    manual = "manual"
    carry_over = "carry_over"


class UserRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    display_name: Mapped[str] = mapped_column(String(128), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tehran")
    theme: Mapped[str] = mapped_column(String(16), default="system")  # light|dark|system
    role: Mapped[str] = mapped_column(String(16), default=UserRole.admin.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # False → login blocked, sessions revoked
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Area(Base):
    __tablename__ = "areas"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    color: Mapped[str] = mapped_column(String(9), default="#6366f1")
    billable_default: Mapped[bool] = mapped_column(Boolean, default=False)
    key_prefix: Mapped[str | None] = mapped_column(String(16), unique=True)  # e.g. "SBU" → tasks SBU-001
    task_counter: Mapped[int] = mapped_column(Integer, default=0)
    default_task_type: Mapped[str | None] = mapped_column(String(16))  # None → timed
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    projects: Mapped[list["Project"]] = relationship(
        back_populates="area", cascade="all, delete-orphan", passive_deletes=True,
        order_by="Project.sort_order",
    )
    tasks: Mapped[list["Task"]] = relationship(
        foreign_keys="Task.area_id", passive_deletes=True,
    )


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        # A subproject's parent must itself be a top-level project (depth 1 only).
        CheckConstraint(
            "parent_project_id IS NULL OR parent_project_id <> id",
            name="ck_project_parent_not_self",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)
    parent_project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )  # set → this row is a subproject/course
    name: Mapped[str] = mapped_column(String(128))
    color: Mapped[str | None] = mapped_column(String(9), default=None)
    key_prefix: Mapped[str | None] = mapped_column(String(16))  # e.g. "MCDA" → tasks MCDA-001
    task_counter: Mapped[int] = mapped_column(Integer, default=0)
    default_task_type: Mapped[str | None] = mapped_column(String(16))  # None → area default → timed
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    area: Mapped[Area] = relationship(back_populates="projects")
    parent: Mapped["Project | None"] = relationship(remote_side="Project.id", backref="subprojects")
    tasks: Mapped[list["Task"]] = relationship(
        foreign_keys="Task.project_id", passive_deletes=True,
    )


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("NOT (area_id IS NOT NULL AND project_id IS NOT NULL)", name="ck_task_home"),
        CheckConstraint("estimate_minutes IS NULL OR estimate_minutes > 0", name="ck_task_estimate"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    area_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("areas.id", ondelete="CASCADE"), index=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    description: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    priority: Mapped[str] = mapped_column(String(16), default=TaskPriority.medium.value, index=True)
    status: Mapped[str] = mapped_column(String(16), default=TaskStatus.backlog.value, index=True)
    task_type: Mapped[str] = mapped_column(String(16), default=TaskType.timed.value, index=True)  # todo | timed
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[date | None] = mapped_column(Date)
    due_time: Mapped[time | None] = mapped_column(Time)  # optional time-of-day on top of due_date
    issue_key: Mapped[str | None] = mapped_column(String(24), unique=True)  # e.g. "SBU-001" (immutable)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # soft-hide; data kept
    recurrence_rule: Mapped[dict | None] = mapped_column(JSON)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    entries: Mapped[list["TimeEntry"]] = relationship(back_populates="task", passive_deletes=True)
    subtasks: Mapped[list["Subtask"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", passive_deletes=True,
        order_by="Subtask.sort_order",
    )
    tag_links: Mapped[list["TaskTag"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", passive_deletes=True,
    )
    memberships: Mapped[list["SprintMembership"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", passive_deletes=True,
    )


class Subtask(Base):
    __tablename__ = "subtasks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped[Task] = relationship(back_populates="subtasks")


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_tag_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))

    task_links: Mapped[list["TaskTag"]] = relationship(
        back_populates="tag", cascade="all, delete-orphan", passive_deletes=True,
    )


class TaskTag(Base):
    __tablename__ = "task_tags"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)

    task: Mapped[Task] = relationship(back_populates="tag_links")
    tag: Mapped[Tag] = relationship(back_populates="task_links")


class Sprint(Base):
    __tablename__ = "sprints"
    __table_args__ = (UniqueConstraint("user_id", "start_at", name="uq_sprint_user_start"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(256))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default=SprintStatus.active.value, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    memberships: Mapped[list["SprintMembership"]] = relationship(
        back_populates="sprint", cascade="all, delete-orphan", passive_deletes=True,
    )
    report: Mapped["WeeklyReport | None"] = relationship(
        back_populates="sprint", cascade="all, delete-orphan", passive_deletes=True, uselist=False,
    )


class SprintMembership(Base):
    __tablename__ = "sprint_memberships"
    __table_args__ = (UniqueConstraint("sprint_id", "task_id", name="uq_membership"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    sprint_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sprints.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16), default=MembershipSource.manual.value)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sprint: Mapped[Sprint] = relationship(back_populates="memberships")
    task: Mapped[Task] = relationship(back_populates="memberships")


class TimeEntry(Base):
    __tablename__ = "time_entries"
    __table_args__ = (
        # Either a real session (start → end) or a duration-only log
        # (both times NULL, attributed to logged_date).
        CheckConstraint(
            "(start_at IS NULL AND end_at IS NULL) OR (end_at > start_at)",
            name="ck_entry_order",
        ),
        CheckConstraint("minutes > 0 AND minutes <= 1440", name="ck_entry_minutes"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Duration-only entries: no start/end, the whole amount is attributed to this day.
    logged_date: Mapped[date | None] = mapped_column(Date, index=True)
    minutes: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text)
    billable: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    task: Mapped[Task] = relationship(back_populates="entries")


class TaskDependency(Base):
    """A blocking edge: `blocker` blocks `blocked` (Jira-style «blocks»)."""

    __tablename__ = "task_dependencies"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_dependency_edge"),
        CheckConstraint("blocker_id <> blocked_id", name="ck_dependency_not_self"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    blocker_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    """Standalone calendar event: title + date + optional time (no task, no sprint)."""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(512))
    event_date: Mapped[date] = mapped_column(Date, index=True)
    event_time: Mapped[time | None] = mapped_column(Time)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class WeeklyReport(Base):
    __tablename__ = "weekly_reports"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    sprint_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sprints.id", ondelete="CASCADE"), unique=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON)

    sprint: Mapped[Sprint] = relationship(back_populates="report")
