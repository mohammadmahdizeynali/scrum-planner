# Decision log

> Agent working notes — internal reference, not user-facing product documentation.
> Every decision from our planning conversation, ADR-style. Statuses: **agreed** (owner
> decided) or **proposal** (my default, owner can veto at review). Date: 2026-08-28.

## Product

| # | Decision | Status |
| --- | --- | --- |
| D1 | Personal planner web app; desktop + mobile via browser; installable PWA, online-only (no offline sync) | agreed |
| D2 | Entire UI in Persian, full RTL | agreed |
| D3 | Jalali calendar for all date display; weeks Saturday → Friday | agreed |
| D4 | Persian digits for dates; Latin digits for clock times/durations | agreed |
| D5 | The app is fully self-contained in the UI for the user; my `.md` files are agent-only working notes | agreed |
| D6 | No live timer; post-hoc calendar logging (Tempo-like) | agreed |

## Architecture

| # | Decision | Status |
| --- | --- | --- |
| D7 | Backend: FastAPI (Python) | agreed |
| D8 | Database: PostgreSQL | agreed |
| D9 | Frontend: React + Vite (+ Tailwind CSS) | agreed |
| D10 | Auth: username + password, server-side sessions, session cookie | agreed |
| D11 | Single user now; users/roles designed into the schema for later | agreed |
| D12 | Deployment: Docker images + docker-compose for any VPS | agreed |
| D13 | Caddy reverse proxy with automatic TLS inside the compose stack | proposal |
| D14 | Store UTC, display in user timezone (default Asia/Tehran); week/month buckets in user TZ | proposal |
| D15 | UUID primary keys | proposal |
| D16 | Backup: nightly pg_dump sidecar, 14-day retention; optional in-app JSON export in phase 7 | proposal |
| D17 | Reports: no file exports (no Markdown/PDF); in-app pages only | agreed (owner correction) |

## Domain & workflow

| # | Decision | Status |
| --- | --- | --- |
| D18 | Hierarchy: Area ("Big Project") → Projects → Tasks; areas also hold area-level tasks | agreed |
| D19 | Standalone tasks exist (no area, no project) for ad-hoc items; still sprint-tracked and logged | agreed |
| D20 | Statuses: Backlog → Open (on sprint add) → In Progress → Closed; transitions never enforced (flexible) | agreed |
| D21 | Priority: High / Medium / Low, default Medium | agreed |
| D22 | One estimate per task in hours; editable in the add-to-sprint dialog | agreed |
| D23 | Task fields include description AND notes as separate texts | agreed |
| D24 | Extras wanted: due dates, recurring tasks, subtasks/checklists, tags | agreed (deferred to phase 6) |
| D25 | Billable flag on time entries (no rates/money) | agreed |

## Sprints

| # | Decision | Status |
| --- | --- | --- |
| D26 | Fixed weekly sprints, Saturday → Friday, one per week | agreed |
| D27 | Sprint close: owner decides per unfinished task — carry / back to Backlog / close anyway | agreed |
| D28 | Sprints auto-created weekly (owner never creates them) | proposal |
| D29 | Sprint naming = Jalali date range (e.g. «اسپرینت ۳۱ مرداد تا ۶ شهریور ۱۴۰۵») | proposal |
| D30 | Weekly report = entries dated in the sprint week whose task is a member; snapshot frozen at close (EC-3); monthly recomputes live | proposal (owner chose "report at close" model; exact inclusion rule to confirm) |
| D31 | Close offered from Saturday of the following week; reopen allowed until next sprint closes | proposal |

## Time tracking

| # | Decision | Status |
| --- | --- | --- |
| D32 | Dedicated Timesheet page (not embedded in Sprint page), full week view with prev/next/«امروز» navigation | agreed |
| D33 | Full drag editing: create, move, resize; click to edit | agreed |
| D34 | 15-minute snapping | proposal |
| D35 | Overlaps allowed, visually flagged (warn, never block) | agreed |
| D36 | Entry = task + start + end + note + billable; no taskless entries | agreed |
| D37 | Entries editable/deletable forever, including past weeks and closed sprints | agreed |

## UX

| # | Decision | Status |
| --- | --- | --- |
| D38 | Main nav: Sprint · Timesheet · Reports · All Tasks · Areas | agreed (owner's "three main pages" + dedicated timesheet) |
| D39 | Kanban-style status columns live on the Sprint page (not per-project boards) | proposal (interpretation of owner's pages) |
| D40 | Vazirmatn font; dark mode included | proposal |
| D41 | Reports page = monthly view navigated by Jalali month + archived weekly reports | agreed |
| D42 | All Tasks page = backlog-style global list with filters + quick-add standalone tasks | agreed |

## Process

| # | Decision | Status |
| --- | --- | --- |
| D43 | No implementation/architecture decision finalized without discussing with the owner first | agreed (ground rule) |
| D44 | Phased implementation (roadmap.md), owner validates each phase before the next | proposal |
| D45 | skills.md is the agent's learning journal, maintained by the agent, not user-facing | agreed |

## Implementation decisions (during build, 2026-08-29)

| # | Decision | Status |
| --- | --- | --- |
| D46 | Schema creation via `Base.metadata.create_all` at startup for v1; Alembic deferred until the schema first evolves (spec said Alembic autostart) | agent deviation |
| D47 | Postgres ENUM types replaced by String columns + CHECK constraints; `citext` replaced by lowercase enforcement in the service layer — for portability and simpler migrations | agent deviation |
| D48 | Frontend Jalali stack: vendored jalaali-js algorithm (`lib/jalaali.ts`) + Intl `formatToParts` timezone helpers (`lib/tz.ts`) instead of date-fns-jalali — exact control over zoned wall-clock math (week = Sat→Fri in user TZ), fewer deps | agent deviation |
| D49 | Timesheet drag implemented with custom pointer-events (predicted in skills.md — dnd-kit is wrong shape for a continuous grid); kanban uses dnd-kit | implemented |
| D50 | `closed_at` column on tasks (from reports.md proposal) — implemented, drives "completed" sections | implemented |
| D51 | `area_billable_default` added to Task payload so the UI can prefill the billable toggle from the area default | agent addition |
| D52 | Billable default flow: API applies area `billable_default` when `billable=null`; UI prefills from task payload and sends explicit value | implemented |
| D53 | Sprint board shows member tasks in 3 columns (باز/در حال انجام/انجام شد); Backlog reachable via add-picker | implemented |
| D54 | Local/LAN deployment mode: `DOMAIN=:80` + `PLANNER_COOKIE_SECURE=false`; on a VPS set a real domain → Caddy auto-HTTPS + secure cookies | agent addition |
| D55 | Completed-tasks criterion in weekly report: member task with status Closed and (closed_at ≥ sprint start) — covers tasks closed during the week and at close time | implemented per reports.md |

## GitHub + backup system (2026-08-29)

| # | Decision | Status |
| --- | --- | --- |
| D56 | Project goes to a PRIVATE GitHub repo; `.env`, `backups/`, build artifacts excluded via `.gitignore` | agreed |
| D57 | Backup ZIP contents: db dump + `.env` + compose.yml + docker/ + restore.sh + Persian restore guide — one file restores a new server | agreed (include .env confirmed by owner) |
| D58 | Automatic backup: every Saturday 02:00 in the admin user's timezone (≈2h after sprint end), with startup catch-up if a slot was missed; implemented as an asyncio loop in the backend lifespan | agreed |
| D59 | Manual backup: button in Settings (پشتیبان‌گیری) — builds ZIP, delivers, offers browser download | agreed |
| D60 | Delivery channels (env-activated, both optional): Telegram sendDocument; private GitHub repo via Contents API (base64 PUT into backups/). Owner plans to deploy on an external (2c/4GB) server where Telegram is reachable | agreed |
| D61 | Nightly local pg_dump sidecar REMOVED — weekly ZIP is the only automatic backup; ZIPs also kept on server (last 10) in ./backups | agreed (owner chose "weekly ZIP only") |
| D62 | pg_dump client pinned to server major (16) via PGDG repo — client 18 emits `SET transaction_timeout` which PG16 rejects on restore | implementation lesson |

## Issue keys (2026-08-29)

| # | Decision | Status |
| --- | --- | --- |
| D63 | Every Area carries a Latin prefix (`key_prefix`, e.g. `SBU`); tasks under it (direct or via project) get `SBU-001`, `SBU-002` … (3-digit zero-pad, grows past 999). Standalone tasks have no key. Keys are immutable — moving a task to another area keeps its key. | implemented (owner request) |
| D64 | Prefix is locked once the area has keyed tasks (409 on change) to preserve key identity; duplicate prefixes rejected case-insensitively; format `^[A-Z][A-Z0-9]{1,9}$`. Existing (pre-feature) tasks are not retro-keyed — only new tasks after the prefix is set. | implemented |
| D65 | Search matches issue keys: exact (`SBU-002`), sloppy (`sbu-2`, `sbu 2` → padded exact), and bare prefix (`SBU` → all) — in global search and All Tasks filter. | implemented |
| D66 | Schema evolution: Alembic still deferred; a small idempotent startup migration (`ensure_schema_upgrades`) ALTERs live tables and creates the unique indexes (areas.key_prefix, tasks.issue_key). | implemented |
| D67 | Closed sprints are read-only: adding/removing members is rejected server-side (409); the Sprint page shows a بسته‌شده badge, hides add/drag/remove, and swaps the close button for «بازگشایی اسپرینت» (reopen). Task-level edits (title/status via drawer, time logging) remain allowed — only sprint membership is frozen. | agreed (owner request) |
| D68 | Estimate entry everywhere uses the shared DurationInput — two side-by-side boxes `[ h ] [ min ]` (Latin unit labels, minutes clamped 0–59). The `2:15`/decimal text-input styles are removed from the codebase entirely. | agreed (owner request) |
| D69 | Issue-key retro-keying: setting (or changing, when allowed) an area prefix assigns keys to ALL its existing tasks (area-level + via projects) in creation order; counter continues from there. A startup backfill covers prefixed areas for already-deployed data. | implemented (completes the sprint-keys request) |
| D70 | «تایم‌شیت» renamed to **«ثبت زمان»** (menu + page title) — more meaningful than the loanword. | agreed (owner request) |
| D71 | Friday's holiday tint removed from the timesheet week grid — holiday coloring isn't relevant in a personal planner. Today-only highlighting remains. | agreed (owner request) |

## Daily Telegram digests (2026-08-29)

| # | Decision | Status |
| --- | --- | --- |
| D72 | Morning briefing (06:00 local, tunable): current sprint tasks grouped by status with issue key + estimate/logged, and a مهلت‌ها section (overdue / today / tomorrow) covering deadline reminders for ALL non-closed tasks. Evening summary (23:00 local, tunable): per-task logged time for the day, billable split omitted, tasks closed today. | implemented |
| D73 | Delivery reuses the backup Telegram credentials (dedicated notify_* envs may override); messages are HTML with escaping, chunked under Telegram's 4096-char limit; missed daily slots are skipped (no stale digests); admin-only preview endpoint `/api/v1/notify/preview` renders the exact text without sending. | implemented |

## Planning assistant + recurring auto-inject (2026-08-30)

| # | Decision | Status |
| --- | --- | --- |
| D74 | Recurring tasks (backlog/open, with a rule) are AUTO-INJECTED into every newly created sprint (source=manual, backlog→open). The owner explicitly chose auto-inject over suggest-only for routine work; removing a task from the sprint is still possible and won't re-inject (injection runs only at sprint creation). | agreed (owner request) |
| D75 | Planning assistant = READ-ONLY suggestions: `GET /sprints/current/suggestions` returns reason-tagged non-member tasks (overdue / due_this_week / logged_last_week / recurring), sorted by urgency. UI: a slim banner only while the sprint is empty (dismissable per sprint via localStorage) + a compact «پیشنهادها (N)» header chip; confirming goes through the normal add-tasks endpoint. The sprint loop and mid-week adds are untouched. | agreed (owner constraints: suggestion-only, no clutter) |
| D76 | JSON columns and NULL: SQLAlchemy/psycopg store Python None in a JSON column as the JSON `null` *literal*, which `IS NOT NULL` matches. Any "has value" predicate on a JSON column must cast to text and exclude `'null'`/`'{}'` (see `task_has_recurrence` in services/recurrence.py). | implementation lesson |
| D77 | Reports trends: `GET /reports/trends?weeks=8` computes the last N sprint-weeks LIVE (per-area stacked bars + estimate dashed marker per week + delta chips for past weeks only + accuracy verdict comparing avg |logged−estimate| of the older vs newer half). Pure CSS bars — still no chart library. | implemented (owner priority) |
| D78 | Archive: tasks get an `archived_at` state (orthogonal to status). Archived tasks hide from lists/boards/suggestions/briefings but their time entries remain in all reports. انبار page: «آرشیو» filter + restore/permanent-delete per row; drawer gets a بایگانی action. | agreed (owner request) |
| D79 | Retention: a انبار bottom section lists CLOSED tasks with `closed_at` before the start of (current Jalali month − 3) — e.g. in Shahrivar, Ordibehesht-and-older. Permanent deletion only behind explicit checkbox+confirmation; nothing auto-deletes, everything newer stays. | agreed (owner request) |
| D82 | «حوزه‌ها» renamed to **«مسیرها»** (owner's pick among دسته‌ها/زمینه‌ها/گروه‌ها/مسیرها) — all user-facing strings (nav, page, dialogs, toasts, API error strings, «بدون مسیر», «تسک مسیر», reports «وظایف مسیر») and docs updated; code/API identifiers stay `Area`/`areas` (zero-risk rename). | agreed (owner pick) |
| D80 | Weekly pace indicator (dashed daily-target line on the timesheet). | REMOVED — see D83 |
| D81 | Timesheet day-header row moved INSIDE the scroll container as a sticky bar — a header above a scrollable grid misaligns by the scrollbar width (classic today-highlight offset). Both now share one width context. | fix (owner report) |

## Open questions for the owner (doc review)

1. Any **proposal** rows above to veto? (esp. D13, D14, D28–D31, D34, D39, D40)
2. Deletion behavior confirmations (FR-2.3, FR-3.2, FR-4.6) — comfortable with move-or-delete dialogs?
3. Estimates: is decimal hours the input style you want (e.g. `1.5`), or «ساعت و دقیقه» pickers?
4. Sprint page columns: OK that Backlog tasks are not shown there (only via add picker)?
5. Anything you want visible on the Sprint page that's not listed (sprint goal field? none for now?)?

| D83 | Pace indicator removed at the owner's request: the timesheet reverted to its pre-pace state (green daily-target line, week-sprint query, and the sprint-list `estimate_minutes` payload all reverted). The sticky-header alignment fix (D81) is kept. | agreed (owner request) |
| D84 | Multi-user goes live: admin creates member accounts in a dedicated **مدیریت** screen. Admin manages **accounts only** — zero access to other users' workspaces (private model confirmed). Exactly one admin, ever (create API always yields `member`); guards: no self-delete/self-deactivate, admin rows not editable/deletable, password reset & deactivation revoke sessions, delete cascades the user's whole workspace. `users.is_active` added (login guard + auto-migration on boot). | agreed (owner answers: accounts-only, exactly one admin) |
| D85 | **v1.1.0 dual task-type model** (owner note): every task is `todo` (فقط انجام — completion only, no logs/estimates/timesheet) or `timed` (زمان‌دار). Areas, projects, subprojects, and sprints all support a mix of both, with configurable per-area/per-project defaults; explicit choice at creation wins. To-Do tasks are excluded from the timesheet picker and complete without a work log. | agreed (owner note, 2026-09-25) |
| D86 | **Hierarchy + issue keys (v1.1.0):** subprojects are self-referencing `Project` rows (`parent_project_id`, depth 1). Issue keys: 2–5 Latin chars (letter first), **one namespace across areas + projects** so task keys never collide; task keys generate from nearest prefixed ancestor (direct project → parent project → area). Prefixes are immutable once tasks carry their keys. | agreed (owner's MCDA example) |
| D87 | **Project close lifecycle:** `projects.closed_at`; close/reopen endpoints; closed projects leave default lists (opt-in `include_closed`), subprojects close independently from parents; deletion of a project promotes its subprojects in move-mode. | proposal (implementation shape; requirement is the owner's) |
| D88 | **Dependencies:** `task_dependencies` edges (blocker → blocked), linked by issue key; «سد شده» badge when any blocker is not closed; lists in the task drawer; no status enforcement (Jira-style visibility only). | proposal (Jira parity) |
| D89 | **Deadlines get time:** `tasks.due_time` (TIME) added alongside `due_date`; clearable separately; shown as `Jalali date – HH:MM`. | agreed (owner item) |
| D90 | **Duration-only time logging:** a `TimeEntry` may have NULL start/end plus `logged_date` + minutes (e.g. `2h 30 min` per day/sprint). `ck_entry_order` relaxed accordingly; all totals, reports, trends, and the Telegram evening summary count these entries. | agreed (owner item) |
| D91 | **Auto-archive on completion** (owner item): closing a task sets `archived_at` automatically (also via sprint close). Archived tasks stay on the sprint board (members query no longer filters archive), stay searchable, and reopen un-archives. | agreed (owner item) |
| D92 | **Sprint page grows two additions** (owner items): a **structure view** (Jira-Structure-inspired: area → project → subproject → tasks, kanban toggle kept per user) and a **«برنامه هفته» panel** listing standalone events plus due-dated sprint tasks, current sprint indigo vs next sprint violet. | agreed (owner items) |
| D93 | **Phase 0 fixes confirmed & shipped:** the warehouse «add to sprint» error was a missing `POST /sprints/current/tasks` route (frontend posted there; only `GET /current` existed) — route added; deadline removal now has an explicit clear button; Planning Assistant label fixed to «مجموع برآورد». | fixed |
