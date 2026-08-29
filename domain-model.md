# Domain model

> Agent working notes — internal reference, not user-facing product documentation.

## Entities and relationships

```
User 1──* TimeEntry *──1 Task
User 1──* Area 1──* Project
User 1──* Task
Task *──* Sprint        (via SprintMembership, carries history)
Area 1──* Task          (area-level tasks)
Project 1──* Task
Task 1──* Subtask
Task *──* Tag           (via TaskTag)
Sprint 1──1 WeeklyReport (0..1 — only closed sprints)
```

## Placement rule (the heart of the model)

A task's home is **exactly one** of:

1. `project_id` set → belongs to a project; its area is derived via `project.area_id`.
2. `area_id` set, `project_id` null → area-level task.
3. both null → standalone task (quick ad-hoc work).

DB constraint: `NOT (area_id IS NOT NULL AND project_id IS NOT NULL)`.
Do not store the derived area on project tasks — always join through the project.

## Entity notes

### Task
- `status`: Backlog | Open | In Progress | Closed. Only automatic transition: Backlog → Open on
  first sprint membership. Everything else manual (or the sprint-close "close anyway" action).
- `closed_at` timestamptz, set whenever status transitions to Closed, cleared when it leaves
  Closed — drives "completed tasks" in reports (completed = closed during the period).
- `estimate_minutes` int, nullable. Store minutes, never floats, to keep sums exact
  (1.5 ساعت = 90). Display converts to decimal hours.
- `priority`: high | medium | low (default medium).
- `recurrence_rule` JSONB, nullable: `{kind: "every_n_days", n} | {kind: "weekly", weekdays: [..]}
  | {kind: "monthly_jalali", day}` — `weekdays` uses Python `weekday()` convention
  (Mon=0 … Sat=5, Sun=6), so Saturday = 5. Freeze this convention in a single constants module.
- `sort_order` int for manual ordering within lists **[Proposal]**.
- Soft-delete NOT planned; deletion is permanent (with confirmations, see requirements FR-2.3/3.2/4.6).

### Sprint
- Weekly: `start_at` (Saturday 00:00 user-TZ, stored UTC), `end_at` (Friday 24:00). Never
  custom lengths **[agreed]**. One per ISO-ish week — uniqueness on `start_at`.
- `status`: active | closed. Close is manual; reopen allowed (regenerates the report on next close).
- `name`: date range in Jalali, e.g. «اسپرینت ۳۱ مرداد تا ۶ شهریور ۱۴۰۵» **[Proposal: range
  name instead of week number]**.

### SprintMembership
- `(sprint_id, task_id)` unique. `added_at`, `source`: manual | carry_over.
- History preserved: carry-over creates a NEW membership row in the next sprint; the old one
  stays for reporting ("this task was in weeks 35 and 36").

### TimeEntry
- `task_id` NOT NULL, `start_at`/`end_at` timestamptz UTC, `note` text nullable,
  `billable` boolean, `created_at`, `updated_at` (audit of edits).
- Duration = end − start, computed (optionally cached as `minutes` column for fast sums).
- No link to sprint on the entry: sprint association is derived
  (entry date within sprint range + task membership) — see `sprints.md` inclusion rule.
- Overlaps are legal data; only flagged in UI. Reports always sum raw durations.

### Area / Project
- `color` (hex), `sort_order`, `billable_default` boolean on Area **[Proposal: area-level flag
  controlling the billable default of new entries]**.
- Project inherits area's `billable_default` unless overridden.

### Subtask / Tag
- Subtask: `task_id`, `title`, `done`, `sort_order`. No due dates/estimates on subtasks.
- Tag: user-scoped unique lowercase name; TaskTag join. Tags are cross-cutting filters only.

### WeeklyReport
- One per closed sprint: `sprint_id` unique, `generated_at`, `payload` JSONB (the four
  sections, precomputed numbers), `schema_version`. Regenerated whenever the sprint is
  re-closed. Point-in-time archive (EC-3).

### User
- `username`, `password_hash` (argon2id), `display_name`, `timezone` (IANA string),
  `theme` (light|dark|system), `role` (admin|member). All owned rows carry `user_id` so the
  schema is multi-user-ready (see `roles.md`).

## Invariants worth enforcing in code

1. A task never has both `area_id` and `project_id` set.
2. `end_at > start_at` for entries; duration ≤ 24h.
3. Sprint ranges: exactly Sat 00:00 → Fri 24:00 in the owner's timezone, non-overlapping.
4. One active sprint "current" at any instant (the one containing now).
5. Closed status on a task never blocks time logging (late logging is expected).
