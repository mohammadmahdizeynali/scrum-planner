# Requirements

> Agent working notes — internal reference, not user-facing product documentation.
> IDs are stable; reference them in decisions and implementation PRs.

## FR-1 Auth & account

- FR-1.1 Login page: username + password; session cookie (HttpOnly, Secure, SameSite=Lax).
- FR-1.2 Logout action in the user menu.
- FR-1.3 One admin user seeded at first start (from env credentials); password stored with
  argon2id. Login endpoint rate-limited.
- FR-1.4 Profile settings: display name, timezone (default `Asia/Tehran`), theme (light/dark/system).
- FR-1.5 Users/roles exist in the schema from day one (see `roles.md`) even though only one user exists.

## FR-2 Areas (Big Projects)

- FR-2.1 CRUD: name, color, sort order. Shown in the Areas & Projects management screen.
- FR-2.2 An area contains projects and area-level tasks; it can also contain neither.
- FR-2.3 Deleting an area **[Proposal]**: confirmation dialog offering (a) move its projects
  (and their tasks) to another area, or (b) permanent delete of everything inside, with a
  warning listing total logged hours that would be lost.

## FR-3 Projects

- FR-3.1 CRUD within an area: name, color (defaults to area color), sort order.
- FR-3.2 Deleting a project **[Proposal]**: confirmation offering (a) move its tasks to the
  area level, or (b) permanent delete; warning shows tasks affected and logged hours lost.

## FR-4 Tasks

- FR-4.1 Fields: title (required), description, notes, estimate_hours (decimal, optional),
  priority (High/Medium/Low, default Medium), status (default Backlog), due_date (optional,
  Jalali picker — phase 6), recurrence rule (optional — phase 6), tags (optional — phase 6).
- FR-4.2 A task belongs to exactly one of: a project, an area directly, or nothing (standalone).
- FR-4.3 Description vs notes: description = stable summary of the work; notes = free working
  notes. Both plain text (markdown-lite rendering **[Proposal]**, no images).
- FR-4.4 Status changes are manual and unrestricted; the only automatic transition is
  Backlog → Open when the task joins a sprint (see `sprints.md`).
- FR-4.5 Task detail (drawer/modal from any list): edit all fields, subtask checklist, tags,
  time entry list + quick "log time" form, sprint membership history, total logged vs estimate,
  delete.
- FR-4.6 Deleting a task with logged time: confirm; warning states the hours that will be
  removed from reports **[Proposal]**.
- FR-4.7 Every task view shows: total logged time next to estimate (e.g. `1.25 / 2 ساعت`).
- FR-4.8 Subtasks (phase 6): title + done flag + order; progress (2/5) shown on task rows.
- FR-4.9 Recurring tasks (phase 6): when a recurring task is set Closed, the system creates the
  next occurrence (same fields, Backlog status, due date advanced per rule). Rules: every N
  days; weekly on chosen weekday(s); monthly on a Jalali day-of-month (clamp to month length).
- FR-4.10 Due dates (phase 6): Jalali date picker; overdue + "next 7 days" visible on Sprint
  page header area and All Tasks filters.

## FR-5 Sprints (details in `sprints.md`)

- FR-5.1 One sprint per week, Saturday 00:00 → Friday 24:00 in the user's timezone;
  auto-created when it becomes current **[Proposal: auto-create]**.
- FR-5.2 Add tasks from anywhere (any project, area-level, standalone) via a picker; the
  dialog shows the task's estimate and lets the user edit it at add time.
- FR-5.3 Remove a task from the current sprint (status reverts to Backlog if it was Open).
- FR-5.4 Close sprint: per-unfinished-task decision — carry to next sprint / return to
  Backlog / close as done. Generates the weekly report snapshot.
- FR-5.5 Past sprints are read-only for membership but their weeks remain loggable on the
  timesheet (late logging is expected and must work).

## FR-6 Time tracking (details in `time-tracking.md`)

- FR-6.1 Entry = task + start + end + optional note + billable flag. No entry without a task.
- FR-6.2 Created/edited exclusively on the Timesheet page (drag-create, drag-move, resize,
  click to edit) plus a form-based quick-log on the task detail (Jalali date + times).
- FR-6.3 15-minute snapping for drag operations **[Proposal: 15 min]**.
- FR-6.4 Overlapping entries are allowed and visually flagged (see `time-tracking.md`).
- FR-6.5 Entries are editable/deletable at any time, including past weeks and closed sprints.
- FR-6.6 Billable flag defaults: on for tasks in billable areas (e.g. Freelance), off otherwise
  (area-level `billable_default` boolean) **[Proposal]**.
- FR-6.7 Roll-ups visible in UI: per task, per project, per area, per sprint, per month.

## FR-7 Reports (details in `reports.md`)

- FR-7.1 Weekly report generated as a stored snapshot at sprint close; rendered as an app page.
- FR-7.2 Weekly sections: time per area & project · task-level breakdown · completed tasks ·
  estimate vs actual.
- FR-7.3 Monthly report page navigable by Jalali month, live-computed, with links to each
  week's report.
- FR-7.4 Billable vs non-billable totals in both.

## FR-8 Navigation & screens

- FR-8.1 Main nav: اسپرینت (Sprint) · تایم‌شیت (Timesheet) · گزارش‌ها (Reports) · همه تسک‌ها
  (All Tasks) · حوزه‌ها (Areas). Plus search, theme toggle, user menu.
- FR-8.2 All Tasks page: backlog-style global list; filters (area, project, status, priority,
  tag, due); inline quick-add creates a standalone Backlog task.
- FR-8.3 Global quick search over task title/description/notes (phase 6 for fuzzy, basic
  contains-match from phase 2).

## Edge cases (must be handled, most are **[Proposal]** defaults)

- EC-1 Entry crossing midnight (23:00–01:00): allowed; attributed to the start date.
- EC-2 Single entry > 24h: rejected. Day total > 24h: allowed but flagged like overlaps.
- EC-3 Editing entries after a sprint was closed: allowed; the archived weekly snapshot is NOT
  rewritten (monthly report recomputes live) — snapshot is a point-in-time archive.
- EC-4 Task added to a sprint while already a member of another non-closed sprint: allowed,
  with a warning (rare; carry-over is the normal multi-membership path).
- EC-5 Add-to-sprint of a task that is already Open/In Progress/Closed: keep its status
  (never downgrade); estimate dialog still shows.
- EC-6 Remove-from-sprint of a task that is In Progress: membership ends, status unchanged.
- EC-7 Jalali leap years and month lengths (29–31 days): always via libraries; monthly
  recurrence clamps to the last valid day.
- EC-8 Sprint close when next week's sprint already has carry-overs: merges fine (membership
  is per-sprint, duplicates impossible via unique constraint).
- EC-9 Empty states for every screen (no areas yet, empty sprint, empty week, no reports) with
  one-click next actions.
- EC-10 Timezone boundaries: week/month buckets computed in the user's timezone, not UTC —
  a Saturday 00:30 Asia/Tehran entry belongs to the new week.

## Non-functional requirements

- NFR-1 **RTL everywhere**: `dir="rtl"` at the root; CSS logical properties only (no left/right
  margins); directional icons mirrored; Saturday starts the week at the right edge.
- NFR-2 **Jalali everywhere**: no Gregorian date visible in the UI, ever. Library-based
  conversion only (see `skills.md`).
- NFR-3 **Typography**: Vazirmatn self-hosted (OFL); tabular alignment for time columns.
- NFR-4 **PWA**: manifest (lang=fa, dir=rtl), icons, service worker for installability and
  static asset caching; data always fetched online (no offline sync).
- NFR-5 **Performance**: sprint page and timesheet feel instant (<100ms interactions via
  optimistic updates); lists paginated/virtualized when > a few hundred tasks.
- NFR-6 **Backups**: nightly `pg_dump` to a mounted volume, 14-day retention; restore steps in
  `architecture.md`. Optional in-app JSON export **[Proposal, phase 7]**.
- NFR-7 **Security**: HTTPS via reverse proxy; argon2id; rate-limited login; no secrets in the
  repo (env file).
- NFR-8 **Deployment**: `docker compose up -d` on any VPS brings up the whole stack; images
  built for linux/amd64.
