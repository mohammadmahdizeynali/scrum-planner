import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth / users ----------

class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(ORMModel):
    id: uuid.UUID
    username: str
    display_name: str
    timezone: str
    theme: str
    role: str


class UserUpdateIn(BaseModel):
    display_name: str | None = None
    timezone: str | None = None
    theme: Literal["light", "dark", "system"] | None = None


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


# ---------- areas / projects ----------

class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    color: str = "#6366f1"
    billable_default: bool = False
    key_prefix: str | None = None  # Latin, e.g. "SBU" → tasks SBU-001
    sort_order: int = 0


class AreaUpdateIn(BaseModel):
    name: str | None = None
    color: str | None = None
    billable_default: bool | None = None
    key_prefix: str | None = None
    sort_order: int | None = None


class AreaOut(ORMModel):
    id: uuid.UUID
    name: str
    color: str
    billable_default: bool
    key_prefix: str | None = None
    sort_order: int
    project_count: int = 0
    task_count: int = 0


class DeletePreviewOut(BaseModel):
    projects: int = 0
    tasks: int = 0
    time_entries: int = 0
    logged_minutes: int = 0


class ProjectIn(BaseModel):
    area_id: uuid.UUID
    name: str = Field(min_length=1, max_length=128)
    color: str | None = None
    sort_order: int = 0


class ProjectUpdateIn(BaseModel):
    area_id: uuid.UUID | None = None
    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


class ProjectOut(ORMModel):
    id: uuid.UUID
    area_id: uuid.UUID
    name: str
    color: str | None
    sort_order: int
    task_count: int = 0


# ---------- tags / subtasks ----------

class TagOut(ORMModel):
    id: uuid.UUID
    name: str


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class SubtaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=512)


class SubtaskUpdateIn(BaseModel):
    title: str | None = None
    done: bool | None = None
    sort_order: int | None = None


class SubtaskOut(ORMModel):
    id: uuid.UUID
    title: str
    done: bool
    sort_order: int


# ---------- tasks ----------

RecurrenceRule = dict  # {kind: every_n_days|weekly|monthly_jalali, ...}


class TaskCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=512)
    description: str = ""
    notes: str = ""
    estimate_minutes: int | None = Field(default=None, gt=0)
    priority: Literal["high", "medium", "low"] = "medium"
    area_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    due_date: date | None = None
    recurrence_rule: RecurrenceRule | None = None
    tag_ids: list[uuid.UUID] = []
    subtasks: list[SubtaskIn] = []

    @model_validator(mode="after")
    def check_home(self):
        if self.area_id and self.project_id:
            raise ValueError("یک تسک نمی‌تواند همزمان به مسیر و پروژه متصل باشد.")
        return self


class TaskUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    description: str | None = None
    notes: str | None = None
    estimate_minutes: int | None = Field(default=None, gt=0)
    priority: Literal["high", "medium", "low"] | None = None
    status: Literal["backlog", "open", "in_progress", "closed"] | None = None
    area_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    due_date: date | None = None
    recurrence_rule: RecurrenceRule | None = None
    tag_ids: list[uuid.UUID] | None = None
    clear_estimate: bool = False
    clear_due_date: bool = False
    clear_recurrence: bool = False

    @model_validator(mode="after")
    def check_home(self):
        if self.area_id and self.project_id:
            raise ValueError("یک تسک نمی‌تواند همزمان به مسیر و پروژه متصل باشد.")
        return self


class TaskOut(ORMModel):
    id: uuid.UUID
    title: str
    status: str
    priority: str
    estimate_minutes: int | None
    logged_minutes: int = 0
    due_date: date | None
    issue_key: str | None = None
    area_id: uuid.UUID | None
    project_id: uuid.UUID | None
    area_name: str | None = None
    area_color: str | None = None
    area_billable_default: bool | None = None
    project_name: str | None = None
    active_sprint_id: uuid.UUID | None = None
    tags: list[TagOut] = []
    subtask_total: int = 0
    subtask_done: int = 0
    sort_order: int
    updated_at: datetime


class TaskDetail(TaskOut):
    description: str
    notes: str
    recurrence_rule: RecurrenceRule | None
    created_at: datetime
    closed_at: datetime | None
    subtasks: list[SubtaskOut] = []
    memberships: list["SprintBrief"] = []
    entries: list["EntryOut"] = []


class SprintBrief(ORMModel):
    sprint_id: uuid.UUID
    sprint_name: str
    source: str


# ---------- time entries ----------

class EntryIn(BaseModel):
    task_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    note: str | None = None
    billable: bool | None = None  # None → default from the task's area


class EntryUpdateIn(BaseModel):
    task_id: uuid.UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    note: str | None = None
    billable: bool | None = None


class EntryOut(ORMModel):
    id: uuid.UUID
    task_id: uuid.UUID
    task_title: str = ""
    area_color: str | None = None
    start_at: datetime
    end_at: datetime
    minutes: int
    note: str | None
    billable: bool


# ---------- sprints ----------

class SprintOut(ORMModel):
    id: uuid.UUID
    name: str
    start_at: datetime
    end_at: datetime
    status: str
    closed_at: datetime | None


class SprintMemberOut(BaseModel):
    source: str
    task: TaskOut


class SprintDetail(SprintOut):
    members: list[SprintMemberOut] = []
    logged_minutes: int = 0
    billable_minutes: int = 0
    estimate_minutes: int = 0
    count_open: int = 0
    count_in_progress: int = 0
    count_closed: int = 0


class SprintAddTasksIn(BaseModel):
    items: list["SprintAddItem"] = Field(min_length=1)


class SprintAddItem(BaseModel):
    task_id: uuid.UUID
    estimate_minutes: int | None = Field(default=None, gt=0)


class CloseDecision(BaseModel):
    task_id: uuid.UUID
    action: Literal["carry_over", "backlog", "close"]


class SprintCloseIn(BaseModel):
    decisions: list[CloseDecision] = []


class PlanningSuggestion(BaseModel):
    task: TaskOut
    reasons: list[str]


TaskDetail.model_rebuild()
