# Personal Planner — Roadmap for v1.1.0

> Working draft — edit freely.
> Source: the planned-improvements list shared by the owner (2026-09-25) plus the owner's dual task-type note.
> Last updated: 2026-09-25 — implemented & shipped as v1.1.0

---

## 1. Release goal

v1.1.0 evolves the planner from a basic personal task-management tool into a more structured planning system with:

- flexible task types (To-Do vs Time-tracked)
- proper project hierarchy (Path → Project → Subproject → Tasks)
- issue-based task identification
- task dependencies
- sprint planning with a structured sprint view
- time tracking (including duration-only logging)
- deadlines and events
- archive support
- better desktop and mobile usability

---

## 2. Current state baseline (what already ships today)

So items below are not re-planned from scratch — verified against the code on 2026-09-25:

| Area | Status today |
| --- | --- |
| Hierarchy | Area (مسیر) → Project → Task only. No subproject level; areas and projects cannot be closed (`backend/app/models.py`) |
| Issue keys | Area-level prefix only (`Area.key_prefix`, e.g. `SBU` → tasks `SBU-001`), immutable and unique. No project-level or subproject keys |
| Archive | Manual archive/unarchive exists (`Task.archived_at`, `backend/app/api/tasks.py`). No auto-archive on completion. Retention purge is candidate-based with manual confirmation in the Warehouse |
| Deadlines | `Task.due_date` is a date-only column — no time component |
| Task model | Status only (`backlog` / `open` / `in_progress` / `closed`). No task-type field; no dependency concept |
| Sprints | Fixed-week kanban board (Sat → Fri, per-user timezone) with planning assistant and carry-over. No structure view |
| Time tracking | Weekly drag-create timesheet with 15-minute snapping; `TimeEntry` already stores start/end/minutes/billable |
| Also shipped | Reports with trend charts, Telegram bot, multi-user admin, PWA, backups |
| Not built at all | Task dependencies/blocking, standalone calendar events, duration-only logging UI, task types, sprint structure view |

---

## 3. How to read this roadmap

- Every item is a checkbox. Check items off as work lands.
- Tags on each item:
  - **(bug)** — fix of existing behavior
  - **(extend)** — capability already shipped; needs extension
  - **(new)** — brand-new capability
- Sequencing rule (from the architecture note in the improvements list):

  ```text
  Project Hierarchy  →  Issue Key System  →  Task Dependencies  →  Sprint Structure UI
     (Phase 2)            (Phase 2)             (Phase 3)             (Phase 4)
  ```

  Phases 0 and 1 are independent of this chain and can start immediately.
- Each phase ends with **Done when** criteria.

---

## 4. Phase 0 — Bug fixes & quick wins

- [x] **(bug)** Reset all task-creation form fields after a task is successfully created.
- [x] **(bug)** Prevent the previously selected path/project from remaining in the task form when creating a new item.
- [x] **(bug)** Fix adding tasks from the Warehouse to a sprint.
- [x] **(bug)** Fix the error that occurs when adding a Warehouse task to a sprint (possibly the same root cause as the previous item — confirm first).
- [x] **(bug)** Allow removing a deadline after one has already been assigned.
- [x] **(bug)** Fix incorrect or broken date formatting in the Warehouse.
- [x] **(extend)** Add a clear **Save Changes** action when editing a task from the Warehouse/backlog.
- [x] **(bug)** Fix the Warehouse layout on mobile (see also the cross-cutting mobile track, §9).
- [x] **(bug)** Correct the **Total Estimate** wording/display in the Planning Assistant.

**Done when:** task forms never carry stale state between creations; warehouse tasks join sprints without errors; deadlines can be removed; dates render correctly; editing from the Warehouse has an explicit save; the Planning Assistant label reads correctly.

---

## 5. Phase 1 — Task types & time experience

### 5.1 Dual task-type model (owner note — release-defining)

Every task carries a first-class type, supported everywhere tasks live — in paths, projects, and sprints alike:

- [x] **(new)** Add a task-type field to the data model:
  - **To-Do** — only completion matters; no time logging, no estimate required.
  - **Time-tracked** — duration and details matter; supports logs, estimates, and the timesheet.
- [x] **(new)** Each **path/area** supports both types — an area can hold a mix of To-Dos and Time-tracked tasks; add a configurable default type per area.
- [x] **(new)** Each **project** supports both types, likewise with a per-project default (subprojects inherit this in Phase 2).
- [x] **(new)** Each **sprint** supports both task models side by side: the sprint board tracks To-Dos by completion state and Time-tracked tasks by logged time, with a clear visual distinction between the two.
- [x] **(extend)** Timesheet schedules Time-tracked tasks only.
- [x] **(extend)** Reports count logged time from Time-tracked tasks only.
- [x] **(new)** Type selection in the task creation/edit UI, plus a visual type badge wherever tasks are listed.

### 5.2 Task creation & editing

- [x] **(extend)** Change the creation flow so the user selects the category/project first, then enters the task title.
- [x] **(new)** Allow setting a deadline directly when creating a task.
- [x] **(new)** Add a **Create Another** flow (Jira-style): after creating a task, offer to create another while keeping useful context from the previous one.
- [x] **(bug)** Open the task edit modal in the center of the screen instead of near the edge/corner.

### 5.3 Completion & archive

- [x] **(extend)** Allow tasks to be completed without requiring a work log (To-Do tasks especially).
- [x] **(extend)** Automatically move completed tasks to the archive (both task types).
- [x] **(extend)** Keep archived tasks accessible for history and review.

### 5.4 Time logging

- [x] **(new)** Allow logging time as a total duration without start/end timestamps (e.g. `2h 30m`). `TimeEntry.minutes` already exists — this is a UI gap.
- [x] **(new)** Allow recording the total time spent on a task during a sprint without specifying exact work sessions.
- [x] **(bug)** Close the task selector immediately after selecting a task while creating a work log.
- [x] **(extend)** Make work-log entries/cards wider or more spacious so their information is easier to read.

**Done when:** every task can be marked To-Do or Time-tracked at creation and edit time; areas, projects, and sprints all hold and display a mix of both types correctly; To-Dos complete without any time entry; duration-only logging works; completed tasks land in the archive automatically and remain viewable.

---

## 6. Phase 2 — Project architecture (core of this release)

### 6.1 Hierarchy

- [x] **(new)** Add the subproject/course level so the planner supports:

  ```text
  Path
  └── Project
      └── Subproject / Course
          └── Tasks
  ```

  Example: `University → SBU → MCDA → MCDA-1, MCDA-2, MCDA-3`.
- [x] **(new)** Subprojects support the dual task-type model (§5.1), with per-subproject defaults.

### 6.2 Lifecycle

- [x] **(new)** Allow closing an entire project; separate closed projects from active ones.
- [x] **(new)** Allow closing a subproject independently from its parent project.
- [x] **(new)** Closed projects and subprojects remain available for history/reference where appropriate.

### 6.3 Issue keys

- [x] **(extend)** Allow every project or subproject under a path to have its own independent, manually configured issue key. The key does not have to match the project name.
- [x] **(new)** Issue-key validation: maximum/exact length of five characters; letters and numbers only; unique within the appropriate scope.
- [x] **(extend)** Generate task identifiers from the parent project's issue key (`MCDA-1`, `MCDA-2`, `MCDA-3`), replacing the area-only key generation for tasks that live under projects/subprojects.

**Done when:** a three-level hierarchy can be created and displayed; projects and subprojects can be closed independently and stay browsable; every project/subproject has a validated unique key; tasks created under them get correct `KEY-n` identifiers.

---

## 7. Phase 3 — Dependencies & scheduling

> Depends on Phase 2's issue-key system — dependencies reference tasks by key.

- [x] **(new)** Implement task blocking similar to Jira. Tasks reference each other by issue key:
  - `TASK-12 blocks TASK-18`
  - `TASK-18 is blocked by TASK-12`
- [x] **(new)** Show whether a task is currently blocked.
- [x] **(new)** Display **Blocks** and **Blocked By** relationships in the task details view.
- [x] **(new)** Support deadlines with both date and time (schema change: `due_date` is date-only today).
- [x] **(new)** Support standalone calendar events with at least: title, date, time.
- [x] **(new)** Show scheduled tasks for both the current sprint and the next sprint, using two different visual indicators/colors to distinguish them.

**Done when:** blocking relationships can be created by issue key and are visible in task details with correct blocked state; deadlines carry a time; standalone events exist; scheduled work for the current and next sprint is visually distinguished.

---

## 8. Phase 4 — Sprint structure redesign

> Depends on Phase 2 (hierarchy + keys) and the dual task-type model (§5.1).

- [x] **(extend)** Show **Add to Sprint** for every eligible task that is not already in the target sprint — tasks in Backlog, Open, No Sprint, and other eligible non-sprint states, both To-Do and Time-tracked.
- [x] **(new)** Replace the current kanban-only sprint view with a more structured view inspired by **Jira Structure**, supporting a clearer hierarchical representation of work.
- [x] **(new)** Display the hierarchy, task relationships (blocks/blocked-by), and both task models inside the sprint view.

**Done when:** any eligible task can be added to a sprint in one action; the sprint page renders work as a hierarchy rather than a flat kanban; block relationships and task types are visible in the sprint view.

---

## 9. Cross-cutting — Mobile & responsive

- [x] **(bug)** Fix the Warehouse/backlog layout on mobile devices; prevent horizontal overflow and broken page sizing.
- [x] **(extend)** Ensure tables, cards, forms, and modals behave correctly on small screens.
- [x] **(extend)** Review touch interactions; make buttons, selectors, and task interactions usable on touch devices.

---

## 10. Release checklist

- [x] Bump `frontend/package.json` to `1.1.0` (currently `0.1.0`) and add a matching `version=` to the FastAPI app in `backend/app/main.py`.
- [x] Update `glossary.md` and `decisions.md` with the new concepts: subproject, calendar event, dependency/blocking, To-Do vs Time-tracked task types, project/subproject issue keys.
- [x] Backend pytest coverage: task types, issue-key validation/generation, dependencies, date-time deadlines, project/subproject closing.
- [ ] Playwright e2e coverage for the new create/edit flows and the sprint structure view.
- [x] Update `README.md` wherever user-facing behavior changes (archive behavior, task types).
