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

## Open questions for the owner (doc review)

1. Any **proposal** rows above to veto? (esp. D13, D14, D28–D31, D34, D39, D40)
2. Deletion behavior confirmations (FR-2.3, FR-3.2, FR-4.6) — comfortable with move-or-delete dialogs?
3. Estimates: is decimal hours the input style you want (e.g. `1.5`), or «ساعت و دقیقه» pickers?
4. Sprint page columns: OK that Backlog tasks are not shown there (only via add picker)?
5. Anything you want visible on the Sprint page that's not listed (sprint goal field? none for now?)?
