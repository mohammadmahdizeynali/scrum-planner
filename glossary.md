# Glossary — agreed terminology

> Agent working notes — internal reference, not user-facing product documentation.
> Use these terms consistently in UI strings, code identifiers, and conversation.

## Core entities

| Term (code) | UI (fa) | Meaning |
| --- | --- | --- |
| Area / "Big Project" | مسیر | Top-level life area (University, Freelance, Personal). Holds projects AND area-level tasks. Renamed from «حوزه» to «مسیر» at the owner's request. Code identifiers stay `Area`/`areas`. |
| Project | پروژه | Sub-section of an area (a course, a client). Holds tasks. |
| Task | تسک | The unit of work. May belong to a project, to an area directly, or to nothing (standalone). |
| Standalone task | تسک مستقل | Task with no area and no project (quick ad-hoc items). Always sprint-tracked by the user in practice. |
| Area-level task | تسک مسیر | Task belonging to an area directly, not to any of its projects. |
| Subtask / checklist item | زیرتسک / چک‌لیست | Checkable step inside a task. |
| Sprint | اسپرینت | Fixed one-week period, Saturday 00:00 → Friday 24:00 (user's timezone). One per week. |
| Sprint membership | عضویت در اسپرینت | Record that a task belongs to a sprint. A task can be a member of multiple sprints over time (carry-over). |
| Time entry | ثبت زمان | A logged duration: task + start + end + note + billable flag. The atom of all time reporting. |
| Timesheet | صفحه‌ی ثبت زمان | The dedicated weekly calendar page where entries are created/edited by dragging (renamed from «تایم‌شیت» to «ثبت زمان» at the owner's request). |
| Estimate | برآورد | Planned effort per task, in hours, decimal (e.g. 1.5). |
| Logged | ثبت‌شده | Sum of time entries for the scope in question. |
| Billable | قابل‌صدور فاکتور | Flag on a time entry; default on for billable areas (Freelance), off elsewhere. |
| Carry-over | انتقال به اسپرینت بعدی | Sprint-close action: unfinished task joins next sprint. |
| Sprint close | بستن اسپرینت | Manual end-of-week action; per-task decisions + weekly report snapshot generation. |
| Weekly report | گزارش هفتگی | Snapshot generated at sprint close (4 fixed sections). |
| Monthly report | گزارش ماهانه | Aggregation over a Jalali month (e.g. Mordad), live-computed. |
| Backlog | بک‌لاگ | Both a status (`Backlog`) and the working mode of the **انبار** page (formerly «همه تسک‌ها», renamed to Storage at the owner's request). |

## Statuses (exact UI strings to finalize during implementation)

| Status | fa | Set when |
| --- | --- | --- |
| `Backlog` | بک‌لاگ | Task created (default) — or returned from a sprint |
| `Open` | باز | Task added to a sprint (automatic, editable) |
| `In Progress` | در حال انجام | User starts working (manual) |
| `Closed` | انجام شد | User finishes (manual, or "close anyway" at sprint close) |

Transitions are **not enforced** — any status can be set manually at any time. The sprint-add
auto-transition to `Open` is a convenience nudge, matching the owner's described workflow.

## Priorities

`High` (زیاد) · `Medium` (متوسط) · `Low` (کم). Default for new tasks: `Medium`.

## Conventions

- **Dates:** Jalali, Persian digits. `جمعه ۶ شهریور ۱۴۰۵` — today (2026-08-28) for reference.
- **Clock times:** Latin digits, `02:30–04:00`, tabular alignment.
- **Durations (owner-decided 2026-08-29, final):** display via `fmtDuration` — compact Latin
  `1h 15 min`, `2h`, `45 min`. **Never decimal hours.** Entry via `DurationInput`: two
  side-by-side boxes `[ h ] [ min ]` — the `2:15`/decimal text-input styles are banned.
- **Chart/section numbers (owner refinement, 2026-08-30):** on the Reports page the donut
  percents, completed counts, and trend title use **Latin digits + Latin `%`** (e.g. `45%`).
  Jalali date labels keep Persian digits; durations stay `1h 15 min`.
- **Week:** Saturday → Friday. Saturday is the first day, shown at the **right** edge in RTL.
- **Date ranges:** collapse shared month/year — `هفته‌ی ۷ تا ۱۳ شهریور ۱۴۰۵`,
  `۳۱ مرداد تا ۶ شهریور ۱۴۰۵` (see `faDateRange`).
- **Timezone:** all storage in UTC; display computed in the user's timezone (default `Asia/Tehran`).
- **Honesty marker:** items marked **[Proposal]** in notes are defaults I chose that the owner
  has not explicitly vetoed yet. See `decisions.md`.

## Task Types (v1.1.0)

Every task has a first-class type — the **dual task-type model** (owner note):

| Type | fa | Meaning |
| --- | --- | --- |
| `todo` | فقط انجام | Only completion matters. No time logging, no estimate, hidden from the timesheet picker. |
| `timed` | زمان‌دار | Duration and details matter: logs, estimates, timesheet, billable. |

Defaults resolve explicitly-set > project (or parent project) `default_task_type` >
area `default_task_type` > `timed`. Areas, projects, subprojects, and sprints all
hold a mix of both types; the UI badges them «فقط انجام» / «زمان‌دار».

## Hierarchy & Keys (v1.1.0)

`Area (مسیر) → Project → Subproject/Course → Task`. A subproject is a `Project` row
with `parent_project_id` set (depth 1 only). Areas and projects (incl. subprojects)
can carry an **issue key** — 2–5 Latin chars, letters+digits, starting with a letter,
unique across areas **and** projects (one namespace). Task keys generate from the
nearest prefixed ancestor: direct project → parent project → area (`MCDA-001`).

## New v1.1.0 concepts

- **Blocking/dependency** — `TaskDependency` edge; «سد شده» badge when a non-closed
  blocker exists; `blocks`/`blocked_by` listed in the task drawer; tasks are linked
  by issue key.
- **Duration-only time entry** — a `TimeEntry` with no start/end, attributed to a
  `logged_date` (e.g. `2h 30 min` for the day/sprint). Shown in the drawer, the
  timesheet's «ثبت‌های مدت‌دار» strip, and counted in all totals/reports.
- **Event (رویداد)** — standalone calendar item (title/date/time), managed from the
  sprint page's «برنامه هفته» panel.
- **Project close** — `closed_at` on projects/subprojects; closed ones leave the
  active lists, stay browsable via the مسیرها page, and can reopen.
- **Auto-archive** — closing a task (manually or at sprint close) sets `archived_at`
  automatically; archived tasks remain on the sprint board and searchable.
- **Sprint structure view** — Jira-Structure-inspired hierarchical board (area →
  project → subproject → tasks) alongside the kanban, toggled per user.
