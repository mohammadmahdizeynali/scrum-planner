# Roadmap — implementation phases

> Agent working notes — internal reference, not user-facing product documentation.
> Each phase ends with something the owner can actually use. No phase starts before the
> owner reviews the spec files and approves starting implementation.

## Phase 0 — Review gate (current)

- Spec notes complete (these files). Walk the owner through `decisions.md`, especially all
  **[Proposal]** items; collect vetoes/changes; update files.
- Only then: implementation begins.

## Phase 1 — Foundation & auth (usable skeleton)

- Repo scaffold: `backend/` + `frontend/` + `docker-compose.yml` + `.env.example`.
- Compose: postgres, backend (uvicorn + Alembic autostart), Caddy serving built SPA +
  proxying `/api`. Healthchecks. `pg_dump` backup sidecar (with one tested restore).
- FastAPI skeleton: config, models for users/sessions, login/logout/me, admin seeding,
  rate-limited login. React skeleton: app shell (RTL, Vazirmatn, sidebar, theme), login page,
  session handling, router with protected routes.
- **Done when**: user logs in over HTTPS on a VPS and sees the RTL app shell with empty nav
  pages.

## Phase 2 — Areas, projects, tasks + All Tasks page

- CRUD for areas/projects (colors, order); tasks with placement rule (project / area-level /
  standalone); task detail drawer; All Tasks page with filters + quick-add; basic search
  (contains). Jalali date display everywhere; timezone helper modules established (Sat=5/Sun=6
  convention, week helpers).
- Jalali date-picker spike (react-multi-date-picker) — decision recorded in `skills.md`.
- **Done when**: owner can structure University/Freelance/Personal with tasks and browse them.

## Phase 3 — Sprints

- Weekly auto-creation; Sprint page (columns باز/در حال انجام/انجام شد, drag to change
  status); add-to-sprint picker with estimate confirmation; remove-from-sprint; close flow
  with per-task decisions (carry/backlog/close) + reopen.
- **Done when**: a full week can be planned and closed. (No timesheet yet — hours show 0.)

## Phase 4 — Timesheet (the core logging surface)

- Week grid (RTL, شنبه rightmost), drag-create/move/resize with 15-min snap, edit modal,
  overlap visual warnings, day totals, week navigation, current-time line.
- Task quick-log form. Roll-up endpoints (task/project/area) wired into task lists and cards.
- Mobile day view + tap-to-create.
- Library spike FIRST (pointer-events custom vs @dnd-kit vs react-big-calendar) — see
  `skills.md` before writing code; record findings.
- **Done when**: the owner can log a real week entirely from the timesheet.

## Phase 5 — Reports

- Weekly snapshot generation at sprint close + archived report view.
- Monthly report page (Jalali month nav, summary cards, area/project table, breakdowns,
  completed, estimate vs actual, week strip).
- **Done when**: closing a week produces the report; a month view aggregates correctly
  (test boundary weeks!).

## Phase 6 — Extras (the four chosen features + polish)

- Due dates (+ overdue signals, filters), recurring tasks (3 rule kinds, Jalali monthly
  clamp), subtasks/checklists, tags + tag filters, billable defaults per area, global fuzzy
  search, dark mode final pass.
- **Done when**: all four extras work end-to-end and reports reflect them.

## Phase 7 — PWA, hardening, delivery

- PWA manifest/icons/service worker (vite-plugin-pwa), installable on phone.
- Security pass (cookie flags, rate limits, session expiry), performance pass (virtualized
  lists if needed, optimistic updates), empty-state audit, backup restore drill, compose
  docs finalized. Optional: in-app JSON export **[Proposal]**.
- **Done when**: owner installs it as a PWA on their phone and uses it daily for a week.

## Working agreements during implementation

- The owner validates each phase's UI before the next phase starts.
- Any new decision → update `decisions.md` first, code second.
- Lessons discovered → `skills.md` immediately (that's its purpose).
- The owner never interacts with anything outside the UI; all my operational steps (migrations,
  backups, deployment) are automated or documented here for myself.
