# Architecture

> Agent working notes — internal reference, not user-facing product documentation.

## Stack (agreed)

| Layer | Choice |
| --- | --- |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.x + Alembic, Pydantic v2, argon2-cffi |
| Database | PostgreSQL 16 |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, TanStack Query, date-fns-jalali |
| Auth | Username + password; server-side session table; HttpOnly Secure cookie |
| Delivery | Docker images + docker-compose on any VPS |
| Proxy/TLS | Caddy (automatic HTTPS) **[Proposal]** |
| PWA | vite-plugin-pwa (manifest + service worker, online-only data) |

## Runtime topology (production compose)

```
            internet
               │
        ┌──────▼──────┐
        │    caddy    │  TLS, HTTP→HTTPS, serves static SPA from volume
        │  :80/:443   │  reverse_proxy /api/* → backend:8000
        └──────┬──────┘
        ┌──────┴────────┬───────────────┐
        │               │               │
   ┌────▼─────┐   ┌─────▼──────┐   ┌────▼─────┐
   │ backend  │   │ postgres   │   │  backup  │  nightly pg_dump cron
   │ uvicorn  │──►│ :5432      │◄──│ sidecar  │  → ./backups volume, keep 14
   └──────────┘   └────────────┘   └──────────┘
```

- **Caddy** serves the built SPA (dist mounted as a volume) and proxies `/api/*` to the
  backend — same origin, so no CORS machinery at all. `DOMAIN` env var drives the TLS cert.
- **backend**: uvicorn workers; runs Alembic migrations on start; never exposed publicly.
- **backup**: postgres `pg_dump` cron sidecar writing to a host-mounted `./backups` dir.
  Restore: `docker exec -i postgres psql ... < dump.sql` (verify during implementation).
- Volumes: `pgdata`, `caddy_data`, `caddy_config`, `./backups`.
- `.env`: `DOMAIN`, `POSTGRES_PASSWORD`, `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
  (first boot only seeds admin if no user exists).
- Healthchecks + `restart: unless-stopped` on all services.

## Backend layout

```
backend/
  app/
    main.py            # FastAPI app factory, middleware, router mounting
    core/config.py     # pydantic-settings, env
    core/security.py   # argon2 hashing, session tokens, cookie helpers
    core/timezone.py   # user-TZ aware week/month bucketing (single source of truth)
    core/jalali.py     # jdatetime wrappers for server-side labels only
    db/                # session, base, migrations (alembic/)
    models/            # SQLAlchemy models mirroring data-model.md
    schemas/           # Pydantic request/response
    api/v1/            # auth, users, areas, projects, tasks, subtasks, tags,
                       # sprints, time_entries, reports, settings
    services/          # business logic (sprint close, report build, recurrence)
```

- REST under `/api/v1`; OpenAPI at `/api/docs` (auth-protected).
- All date bucketing (week Sat→Fri, Jalali month) computed **server-side** using the user's
  timezone setting, so reports can't drift from the client clock.
- Errors: consistent `{"detail": ...}`; 422 for validation; 409 for conflicts (e.g. duplicate
  membership).

## Frontend layout

```
frontend/
  src/
    api/            # typed client (openapi-typescript generated)
    features/       # auth, areas, tasks, sprints, timesheet, reports, settings
    components/ui/  # buttons, dialogs, inputs, badges (Tailwind-based)
    lib/jalali.ts   # date-fns-jalali formatting/parsing helpers (single wrapper)
    lib/rtl.tsx     # logical-property primitives if needed
    app/            # router, layout (sidebar right, topbar), theme
```

- TanStack Query for server state; optimistic updates for timesheet mutations.
- State: URL as source of truth for navigation states (selected week, month, filters).
- Jalali date inputs: `react-multi-date-picker` (Persian locale) **[verify in phase 2 spike]**.

## Key flows

- **Login**: POST `/api/v1/auth/login` → sets `planner_session` cookie (random 256-bit token,
  sha256 stored in `sessions`). Middleware resolves user or 401. Logout deletes the row.
- **Sprint auto-create**: on any request needing "current sprint" (or a daily cron inside
  backend), ensure the sprint row for the current week exists — idempotent.
- **Sprint close** (service): validate unfinished tasks → apply per-task decisions →
  build report payload → store `weekly_reports` row → mark sprint closed. Reopen re-opens and
  deletes/regenerates the snapshot on next close.
- **Timesheet mutations**: POST/PATCH/DELETE `/api/v1/time-entries` with optimistic UI;
  server re-validates duration ≤ 24h, end > start.

## Cross-cutting policies

- **Timezone**: store UTC; bucket in user TZ. Single helper in `core/timezone.py`;
  frontend mirrors with `date-fns-tz` + `date-fns-jalali`.
- **Jalali**: client renders all dates (date-fns-jalali). Server uses jdatetime ONLY for
  strings baked into report snapshots (sprint names, month labels).
- **Week definition**: Saturday 00:00 → Friday 24:00 in user TZ. `weekday()` convention:
  Sat=5, Sun=6 (Python). Frontend equivalent: JS `getDay()` Sun=0 → Saturday=6. Isolate in
  the two time helper modules, never inline.
- **Digits**: Persian digits via `Intl.NumberFormat('fa-IR')` for dates; Latin for clock times
  and durations. Central format helpers in `lib/format.ts` — components never call Intl directly.
- **RTL**: Tailwind logical utilities only (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`,
  `text-start`); `dir="rtl"` on `<html>`; flip directional icons; never `left:`/`right:`.
- **Dark mode**: Tailwind `class` strategy, persisted in user settings, `system` default.

## One-time VPS setup (my runbook — the user only ever uses the UI afterwards)

1. Point DNS A/AAAA record at the VPS.
2. Copy `docker-compose.yml` + `.env` (fill DOMAIN, passwords).
3. `docker compose up -d` — migrations run automatically, admin seeded from env.
4. Verify HTTPS cert issued; log in via browser; change password in UI if desired.
5. Backups land in `./backups` nightly; test restore once during phase 1.
