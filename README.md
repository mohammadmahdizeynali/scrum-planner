# برنامه‌ریز شخصی — Personal Planner

A lightweight, personal "mini-Jira" for organizing life into **areas → projects → tasks**, with
**Tempo-style time logging on a weekly calendar**, **fixed weekly sprints**, and **weekly/monthly
reports**. Fully Persian, RTL, and Jalali-calendar based. Runs on any VPS via Docker Compose and
is used from desktop and mobile browsers (installable PWA).

- Single-user today (username + password), multi-user-ready data model
- No live timer — you log time after the fact by dragging ranges on a week grid, exactly like
  planning your day in a calendar
- Sprints are fixed weeks: **Saturday → Friday** (the Persian week); closing a week produces an
  archived report and carries unfinished work forward
- Reports answer "where did my hours go?" per area, project, task — plus estimate-vs-actual and
  billable hours for freelance work

---

## Features

| Area | What you get |
| --- | --- |
| Structure | Areas (حوزه, "Big Project") → projects (courses, clients) → tasks; area-level tasks; standalone ad-hoc tasks |
| Tasks | Description + notes, estimate (hours), priority High/Medium/Low, status flow Backlog → Open → In Progress → Closed, due dates (Jalali picker), recurring tasks, subtask checklists, tags |
| Sprints | One auto-created sprint per week (Sat→Fri); add tasks from anywhere with estimate confirmation; drag between status columns; close with a per-task decision: carry over / back to Backlog / close |
| Timesheet | Dedicated weekly calendar page: drag-create, drag-move, resize (15-min snapping), click to edit; overlaps allowed but visually flagged; current-time line; prev/next week navigation; mobile day view with tap-to-create |
| Time | Billable flag per entry (defaults from the area, e.g. on for Freelance); totals roll up at task / project / area / sprint / month |
| Reports | Weekly report archived at sprint close (time per area & project, task breakdown, completed tasks, estimate vs actual); monthly report per **Jalali month** with week links |
| UI | Persian, full RTL (شنبه starts the week at the right), Vazirmatn font, Persian digits for dates / Latin digits for times, dark mode, global search |
| Platform | Session-cookie auth (argon2id, rate-limited), nightly `pg_dump` backups, installable PWA (online) |

## Tech stack

| Layer | Choice |
| --- | --- |
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · PostgreSQL 16 |
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS · TanStack Query · dnd-kit (board) + custom pointer-events (timesheet grid) |
| Jalali | Vendored jalaali-js algorithm (frontend) · jdatetime (backend, label strings only) |
| Delivery | Docker images + docker-compose: Caddy (static SPA + `/api` reverse proxy, auto-HTTPS optional) → FastAPI → PostgreSQL |
| PWA | vite-plugin-pwa (manifest fa/rtl + service worker, online-only) |

## Screens

`اسپرینت` (current sprint board) · `تایم‌شیت` (weekly logging calendar) · `گزارش‌ها`
(monthly + archived weekly) · `همه تسک‌ها` (backlog-style global list) · `حوزه‌ها`
(areas & projects) · `تنظیمات` (profile, timezone, theme, password)

---

## Quick start (Docker Compose)

Requires Docker ≥ 24 and Docker Compose v2 on any linux/amd64 VPS.

```bash
git clone <this repo> planner && cd planner   # or copy the folder
cp .env.example .env
nano .env        # set passwords; see table below
docker compose up -d --build
```

Open `http://<server-ip>/` and log in with the `ADMIN_USERNAME` / `ADMIN_PASSWORD` you set.
The admin user is seeded automatically on first boot; the database schema is created at startup.

### Environment variables (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOMAIN` | `:80` | Site address for Caddy. `:80` = plain HTTP for any hostname (CDN-friendly). Set to a real domain (e.g. `planner.example.com`) to let Caddy provision HTTPS automatically. |
| `PLANNER_COOKIE_SECURE` | `true` | Session cookie `Secure` flag. **Keep `false` while serving plain HTTP** (CDN → origin over HTTP, or LAN testing); set `true` when the origin is HTTPS. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `planner` / — / `planner` | Database credentials. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / — | Seeded on first boot only (when the users table is empty). |
| `BACKUP_TELEGRAM_BOT_TOKEN` / `BACKUP_TELEGRAM_CHAT_ID` | empty | Telegram delivery of backup ZIPs (optional; needs Telegram reachability). |
| `BACKUP_GITHUB_REPO` / `BACKUP_GITHUB_TOKEN` | empty | Private-repo delivery of backup ZIPs (optional). |

### Deployment behind a CDN (HTTP, no HTTPS needed)

The default `DOMAIN=:80` answers **any Host header**, which makes it ideal behind a CDN:

1. In your DNS/CDN panel create `planner.soophist.ir` pointing at the CDN.
2. In the CDN origin settings: origin IP = your VPS IP, **origin port 80**, protocol HTTP,
   Host-header forwarding ON.
3. Done — the app works over the CDN's HTTP or edge-HTTPS (the cookie is not Secure-flagged).

When you later want end-to-end HTTPS without a CDN: point DNS directly at the VPS, set
`DOMAIN=planner.soophist.ir` and `PLANNER_COOKIE_SECURE=true`, then `docker compose up -d` —
Caddy obtains and renews the Let's Encrypt certificate automatically (ports 80/443 must be open).

---

## Operations

### Services

```
            internet / CDN
                 │ :80 (HTTP) or :443 (HTTPS)
          ┌──────▼──────┐
          │    caddy    │  serves the built SPA, proxies /api/* → backend
          └──────┬──────┘
          ┌──────┴───────┐
          │              │
     ┌────▼─────┐   ┌────▼─────┐
     │ backend  │──►│ postgres │   backend also runs the backup scheduler
     │ FastAPI  │   │  :5432   │   (weekly ZIP → Telegram / GitHub / ./backups)
     └──────────┘   └──────────┘
```

All containers have `restart: unless-stopped`. The backend applies the schema at startup,
contains all business logic (including the backup scheduler), and is the only stateful-path
component besides Postgres; Postgres data lives in the named volume `pgdata`.

### Backups (built-in, no external tooling)

The backend contains a full backup pipeline (it ships `pg_dump`):

- **Automatic**: every **Saturday 02:00** in the admin user's timezone (the sprint ends Friday
  midnight; the ZIP is ready two hours later), plus a catch-up run at startup if a slot was
  missed while the server was down.
- **Manual**: a **«تهیه پشتیبان و ارسال»** button in **تنظیمات** — builds the ZIP, delivers it,
  and offers it as a browser download.
- **ZIP contents**: `db.sql` (full PostgreSQL dump) + your `.env` + `compose.yml` + `docker/` +
  `restore.sh` + a Persian restore guide. One file fully restores a new server.
- **Delivery channels** (activate via `.env`, both optional):
  - Telegram → `BACKUP_TELEGRAM_BOT_TOKEN` + `BACKUP_TELEGRAM_CHAT_ID` (needs a server that can
    reach api.telegram.org),
  - GitHub → `BACKUP_GITHUB_REPO` (private, `owner/name`) + `BACKUP_GITHUB_TOKEN`
    (fine-grained, Contents: Read & Write on that repo only) — the ZIP is uploaded to the repo's
    `backups/` folder.
  Every ZIP is also kept on the server in `./backups/` (last 10).

**Restore on a new server:**

```bash
git clone <your-private-repo> planner && cd planner
cp /path/to/planner-backup-XXXX.zip .        # the ZIP you received
sh <(unzip -p planner-backup-XXXX.zip restore.sh)   # or unzip first, then: sh restore.sh <zip>
```

`restore.sh` restores `.env`/compose files if missing, boots Postgres, drops + recreates the
schema, loads `db.sql`, and starts the whole stack. (The dump is produced by a pg_dump client
pinned to the server's major version — don't mix majors.)

### Updating

```bash
docker compose build          # rebuild images (backend + caddy/frontend)
docker compose up -d          # rolling replace of changed services
docker compose logs -f backend
```

Note: table creation happens automatically at startup; column-level schema changes are applied
with Alembic once the schema starts evolving (not needed for the initial release).

### Useful commands

```bash
docker compose ps                       # status
docker compose logs -f backend caddy    # logs
docker compose restart backend          # restart one service
curl http://localhost/api/health        # health check ({"ok":true})
```

The OpenAPI/Swagger docs exist at the backend's `/docs` but are intentionally **not** exposed
through Caddy — reach them from inside: `docker compose exec backend python -c "print('see /docs on :8000')"`,
or temporarily add a Caddy route if you want them in the browser.

---

## Development

Backend (Python 3.11+):

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -i https://pypi.org/simple/ -r requirements.txt -r requirements-dev.txt
# needs a PostgreSQL; a dev instance is enough:
docker run -d --name planner-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=planner \
  -e POSTGRES_DB=planner -p 5433:5432 postgres:16-alpine

PLANNER_DATABASE_URL=postgresql+psycopg://planner:dev@localhost:5433/planner \
PLANNER_COOKIE_SECURE=false \
  .venv/bin/uvicorn app.main:app --reload        # API on :8000

.venv/bin/python -m pytest tests/ -q             # full suite (uses planner_test DB)
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev          # Vite dev server on :5173, proxies /api → :8000
npm run build        # type-checks (tsc) and builds dist/ + PWA assets
```

`e2e/run.js` contains an optional Playwright walk-through of the whole app (login → areas →
tasks → sprint → timesheet drag → close → reports → dark mode → mobile); it is a development
aid and is not part of the delivered stack.

> Note for servers with regional mirrors: on this VPS the system pip mirror is unreliable —
> use `pip install -i https://pypi.org/simple/`, and give npm generous retry flags
> (`--fetch-retries=6`).

## Project layout

```
├── compose.yml              # production stack (postgres, backend, caddy, backup)
├── .env.example             # copy to .env
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app, startup (schema + admin seed)
│   │   ├── api/             # auth, users, structure (areas/projects), tasks,
│   │   │                    # sprints, time_entries, reports
│   │   ├── services/        # sprint lifecycle, report builders, recurrence
│   │   ├── models.py        # SQLAlchemy schema
│   │   ├── schemas.py       # Pydantic request/response
│   │   └── core/            # config, security (argon2/sessions), timeutils+Jalali
│   ├── tests/               # 30 pytest tests (auth, tasks, sprints, entries, reports)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── features/        # sprint/ timesheet/ reports/ tasks/ areas/ settings/ auth/
│   │   ├── components/      # app shell (RTL sidebar) + ui primitives
│   │   ├── lib/             # jalaali.ts, tz.ts (Intl zoned helpers), format.ts
│   │   └── api/             # typed client + types
│   └── public/icons/        # PWA icons
├── docker/
│   ├── Caddyfile            # static SPA + /api proxy
│   ├── caddy.Dockerfile     # multi-stage: build frontend → Caddy image
│   └── backup.sh            # nightly pg_dump sidecar script
└── *.md                     # internal working notes (spec, decisions, lessons) —
                             # not needed to run the app
```

## Concepts (the model behind the UI)

```
Area (حوزه)  ──< Project (پروژه)  ──< Task (تسک)
    │                                      ▲
    └────────< area-level Task ────────────┘
Standalone Task (no area, no project)
Task >──< Sprint (weekly, Sat→Fri)          via memberships (carry-over keeps history)
Task ──< TimeEntry (start, end, note, billable)   ← the atom of every report
Sprint ──(closed)──> WeeklyReport (frozen snapshot)
```

- A task's home is exactly one of: a project, an area directly, or nothing (standalone).
- Statuses move freely by hand; the only automatic nudge is Backlog → Open when a task joins a
  sprint.
- A time entry always belongs to a task; a sprint report includes entries dated inside the
  sprint week whose task is a member of that sprint. The weekly snapshot never changes after
  the fact; the monthly report recomputes live.
- Week/month boundaries are computed in the user's timezone (default `Asia/Tehran`), stored as
  UTC, and displayed in the Jalali calendar.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login works locally but not through the CDN | Ensure Host-header forwarding is enabled and origin port is 80; check `docker compose logs caddy`. |
| Session immediately lost after login (HTTP) | `PLANNER_COOKIE_SECURE=false` in `.env`, then `docker compose up -d` — Secure cookies are dropped over plain HTTP. |
| Port 80 already in use | Stop the other service or change the Caddy port mapping in `compose.yml`. |
| `429` on login | Rate limit (5 attempts/min per IP+username) — wait a minute. |
| Forgot admin password | `docker compose exec postgres psql -U planner -d planner -c "delete from users;"` then `docker compose restart backend` (re-seeds from `.env`). ⚠️ wipes all data — prefer restoring a backup or setting a new hash. |
| Backups empty | The first dump lands at 03:00 UTC after start; check `docker compose logs backup`. |

---

**Status:** v0.1 — implemented, tested at the API level (30/30 backend tests), deployed and in
daily use by its owner. UI feedback drives iteration.
