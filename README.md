# برنامه‌ریز شخصی — Personal Planner (Scrum Planner)

A lightweight, personal "mini-Jira" for organizing life into **areas → projects → tasks**, with
**Tempo-style time logging on a weekly calendar**, **fixed weekly sprints**, and **weekly/monthly
reports**. Fully **Persian, RTL, and Jalali-calendar** based. Runs on any VPS via Docker Compose,
is used from desktop and mobile browsers, and installs as a PWA.

- Single user today (username + password, session auth), multi-user-ready data model
- No live timer — you log time after the fact by dragging ranges on a week grid (شنبه → جمعه)
- Weekly sprints with a proper close ritual: carry over / send back to backlog / close, and an
  archived weekly report
- Estimate-vs-actual feedback on every report, billable hours for freelance work, project-share
  donut charts
- Built-in backups: a self-restoring ZIP (database + config + restore script) every Saturday
  02:00 + a one-click manual backup — delivered to Telegram and/or a private GitHub repo
- **Jira-style issue keys**: each area defines a Latin prefix (e.g. `SBU`); tasks get
  `SBU-001`, `SBU-002` … — immutable identity, searchable everywhere (even sloppy input like
  `sbu-2`), and existing tasks are retro-keyed when a prefix is set
- **Planning assistant**: reason-tagged suggestions (overdue / due this week / logged last
  week / recurring) in a dismissable panel on empty sprints — confirm adds them via the normal
  flow; recurring tasks are auto-injected into every new sprint
- **Archive & retention**: tasks can be archived (hidden from boards/lists, history kept);
  the انبار page nominates tasks closed 3+ Jalali months ago for optional, confirmed
  permanent deletion — nothing auto-deletes
- **Trend charts**: 8-week per-area stacked bars vs estimate columns with overrun caps,
  per-week deltas, and an estimate-accuracy verdict — plus the project-share donut
- **Daily Telegram digests**: morning sprint briefing with deadline reminders (06:00) and an
  evening summary of logged time (23:00) — see the setup guide below

| Layer | Choice |
| --- | --- |
| Backend | Python 3.12 · FastAPI · SQLAlchemy 2 · PostgreSQL 16 |
| Frontend | React 18 · Vite · TypeScript · Tailwind CSS · TanStack Query · dnd-kit + custom pointer-events grid |
| Jalali | vendored jalaali-js algorithm (frontend) · jdatetime (backend, labels only) |
| Delivery | Docker Compose: Caddy (static SPA + `/api` proxy, optional auto-HTTPS) → FastAPI → PostgreSQL |
| PWA | vite-plugin-pwa (manifest fa/rtl + service worker) |

Screens: **اسپرینت** (current sprint board) · **تایم‌شیت** (weekly logging calendar) ·
**گزارش‌ها** (monthly + archived weekly) · **انبار** (global backlog list) ·
**مسیرها** (areas & projects) · **تنظیمات** (profile, timezone, theme, password, backups).

---

## Deploy on a fresh VPS

> Sizing: **2 vCPU / 4 GB RAM / 20 GB disk** is comfortable (measured steady-state footprint of
> the whole stack is ≈ 130 MB RAM; the only heavy moment is the first image build). Any
> Debian/Ubuntu VPS with Docker works.

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

### 2. Get the code

```bash
git clone https://github.com/mohammadmahdizeynali/scrum-planner.git planner
cd planner
```

(If the repo is private, use your SSH key or an HTTPS token in the clone URL.)

### 3. Configure

```bash
cp .env.example .env
nano .env
```

| Variable | What to set |
| --- | --- |
| `DOMAIN` | `:80` = plain HTTP for any hostname (CDN-friendly, default). For real HTTPS: your domain (e.g. `planner.example.com`) and Caddy provisions certificates automatically. |
| `PLANNER_COOKIE_SECURE` | `false` while serving plain HTTP (CDN→origin, LAN); `true` when the origin is HTTPS. |
| `POSTGRES_PASSWORD` | any strong password (used internally by the stack). |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | your login — seeded on first boot only. **Change the password in Settings after first login.** |
| `BACKUP_TELEGRAM_BOT_TOKEN` / `BACKUP_TELEGRAM_CHAT_ID` | optional — activates Telegram delivery of backup ZIPs (needs a server that can reach api.telegram.org). |
| `BACKUP_GITHUB_REPO` / `BACKUP_GITHUB_TOKEN` | optional — activates GitHub delivery. **Must be a PRIVATE repo** (the ZIP contains your `.env`!). Token: fine-grained, *Contents: Read & Write*, limited to that repo. |
| `NOTIFY_MORNING_HOUR` / `NOTIFY_EVENING_HOUR` | optional — local hours for the daily Telegram briefing and evening summary (defaults **6** and **23**). |

### 4. Start

```bash
docker compose up -d --build
```

First build takes a few minutes (frontend compile + dependencies). The database schema is
created and your admin user seeded automatically.

### 5. Log in

Open `http://<server-ip>/` (or your domain) and log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
Then set a display name, timezone (drives week/month boundaries — default `Asia/Tehran`), and
theme in **تنظیمات**.

### Domain & TLS

- **Behind a CDN (HTTP):** keep `DOMAIN=:80` and `PLANNER_COOKIE_SECURE=false`. In your CDN panel
  set origin = server IP, **origin port 80**, protocol HTTP, Host-header forwarding ON.
- **Direct HTTPS:** point DNS at the server, set `DOMAIN=planner.example.com` +
  `PLANNER_COOKIE_SECURE=true`, keep ports 80/443 open, then `docker compose up -d`. Caddy
  obtains and renews Let's Encrypt certificates automatically.

---

## Updating

```bash
cd planner
git pull
docker compose build
docker compose up -d
```

Schema creation happens automatically at startup. (Column-level migrations will use Alembic
once the schema evolves; not needed for the initial release.)

---

## Backups (built-in — nothing external to install)

The backend ships `pg_dump` and a full backup pipeline.

- **Automatic:** every **Saturday 02:00** in the admin user's timezone (the sprint week ends
  Friday midnight; the ZIP lands two hours later), plus a catch-up run at startup if a slot was
  missed while the server was off.
- **Manual:** **تنظیمات → پشتیبان‌گیری → «تهیه پشتیبان و ارسال»** — builds the ZIP, delivers it
  to the configured channels, and offers it as a browser download.
- **ZIP contents:** `db.sql` (full database dump) · `.env` (config + secrets) · `compose.yml` ·
  `docker/` · `restore.sh` · `RESTORE.md` (Persian guide) — **one file fully restores a server**.
- **Channels** (each activates when both its `.env` values are set): **Telegram**
  (sendDocument to your chat) and **GitHub** (uploaded into `backups/` of the configured
  **private** repo via the API). Every ZIP is also kept on the server in `./backups/` (last 10).

### Restore on a (new) server

```bash
# after git clone + cp your ZIP into the folder:
sh <(unzip -p planner-backup-YYYYMMDD-HHMM.zip restore.sh) planner-backup-YYYYMMDD-HHMM.zip
```

`restore.sh` restores `.env`/compose files if missing, starts Postgres, drops + recreates the
schema, loads the dump, and brings the whole stack up. Verified end-to-end (12 tables + data).

> Note: the dump is made by a pg_dump client pinned to the server's major version (16). If you
> ever upgrade PostgreSQL, re-take a backup after upgrading.

---

## Telegram bot setup (backups + daily digests)

One bot powers both the backup ZIP delivery and the daily digests. Everything below is
**already implemented** — this is only how to turn it on.

### 1. Create the bot
1. In Telegram, open **@BotFather** → `/newbot` → choose a display name and a username
   (e.g. `my_planner_bot`).
2. BotFather replies with an **HTTP API token** like `123456789:AA...` — copy it.

### 2. Get your chat ID
1. Open your new bot in Telegram and press **Start** (the bot can only message you after
   that).
2. Message **@userinfobot** — it replies with your numeric **chat ID** (e.g. `123456789`).

### 3. Configure `.env`
```bash
BACKUP_TELEGRAM_BOT_TOKEN=123456789:AA...
BACKUP_TELEGRAM_CHAT_ID=123456789
# optional — digest hours (local to the admin user's timezone):
NOTIFY_MORNING_HOUR=6
NOTIFY_EVENING_HOUR=23
```
Then `docker compose up -d` to apply. Each channel activates only when both of its values
are set; with no Telegram configured the app runs normally and simply skips delivery.

### 4. What you receive
| When | Message |
| --- | --- |
| **Saturday 02:00** | Backup ZIP (database + `.env` + compose files + restore script) |
| **Daily 06:00** | Morning briefing: sprint tasks by status with issue keys, estimates vs logged, plus مهلت‌ها (overdue / today / tomorrow) |
| **Daily 23:00** | Evening summary: time logged today per task, tasks closed today |

Missed slots (server was down) are skipped, never sent stale. Long messages are split
automatically to respect Telegram's 4096-char limit.

### 5. Verify without waiting
As the admin, call the preview endpoint to see the exact message text (no send):

```bash
curl -s -b "planner_session=<your-session-cookie>" \
  "http://<server>/api/v1/notify/preview?type=morning"
```

(or open it in the browser while logged in). The Settings → پشتیبان‌گیری card also shows
whether each channel is active.

> **Network note:** `api.telegram.org` must be reachable from the server. It is blocked from
> some networks (including Iranian VPSes) — on such servers the digests and Telegram backup
> delivery are silently skipped; the GitHub backup channel and the in-app backup download
> still work. Deploy on a server with normal international access for Telegram features.

## Architecture

```
            internet / CDN
                 │ :80 (HTTP) or :443 (HTTPS)
          ┌──────▼──────┐
          │    caddy    │  serves the built SPA, proxies /api/* → backend
          └──────┬──────┘
     ┌───────────┴───────────┐
     │      backend          │
     │ FastAPI + scheduler   │──►  postgres :5432 (volume pgdata)
     │ pg_dump, backup ZIPs  │     ./backups (last 10 ZIPs)
     └───────────────────────┘
```

- `restart: unless-stopped` everywhere; Postgres healthcheck gates backend startup.
- All datetimes stored UTC; week (Sat→Fri) and Jalali-month boundaries computed in the user's
  timezone; dates rendered Jalali on the client.
- API: REST under `/api/v1` (OpenAPI at backend `/docs`, intentionally not exposed publicly).
- Auth: argon2id password hashing, server-side sessions (revocable), login rate limiting.

## Development

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -i https://pypi.org/simple/ \
  -r requirements.txt -r requirements-dev.txt
docker run -d --name planner-dev-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=planner \
  -e POSTGRES_DB=planner -p 5433:5432 postgres:16-alpine
PLANNER_DATABASE_URL=postgresql+psycopg://planner:dev@localhost:5433/planner \
PLANNER_COOKIE_SECURE=false .venv/bin/uvicorn app.main:app --reload
.venv/bin/python -m pytest tests/ -q          # 34 tests

# frontend
cd frontend && npm install && npm run dev      # :5173, proxies /api → :8000
npm run build                                  # tsc + production bundle + PWA assets
```

## Project layout

```
├── compose.yml              # postgres, backend, caddy
├── .env.example             # copy to .env
├── backend/                 # FastAPI app, services (sprints, reports, backup), tests
├── frontend/                # React app (features/, components/, lib/jalali+tz)
├── docker/                  # Caddyfile, caddy.Dockerfile (multi-stage frontend build)
├── e2e/                     # optional Playwright walk-through (dev aid)
└── *.md                     # internal working notes (spec, decisions, lessons)
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Login works locally but not via CDN | Host-header forwarding must be ON; origin port 80; check `docker compose logs caddy`. |
| Session lost after login over HTTP | Set `PLANNER_COOKIE_SECURE=false` in `.env`, then `docker compose up -d`. Secure cookies are dropped on plain HTTP. |
| Port 80 already in use | Free it or change the port mapping in `compose.yml`. |
| `429` on login | Rate limit (5 attempts/min per IP+username) — wait a minute. |
| Forgot admin password | ⚠️ `docker compose exec postgres psql -U planner -d planner -c "delete from users;"` then `docker compose restart backend` re-seeds from `.env`. Wipes all data — prefer restoring a backup. |
| Backup ZIP not arriving on Telegram | Server must reach api.telegram.org (blocked in IR); check the Settings card status and `docker compose logs backend`. GitHub channel works regardless. |
| Telegram shows "فعال" but fails | Re-check token/chat id; the bot needs at least one Start from you. |

---

**Status:** v0.1 — in daily use by its owner. Persian UI; report bugs and feedback to the repo.
