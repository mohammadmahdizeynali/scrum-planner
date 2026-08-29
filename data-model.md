# Data model — PostgreSQL schema draft

> Agent working notes — internal reference, not user-facing product documentation.
> Final DDL lives in Alembic migrations during implementation; this file is the blueprint.

## Conventions

- `timestamptz` everywhere (UTC); the user's IANA timezone converts for display and bucketing.
- `snake_case`; plural table names; `id UUID` primary keys (v4, `gen_random_uuid()`)
  **[Proposal: UUID over serial — safe for future multi-user sync/export]**.
- Money amounts: none. Durations: minutes (int).
- Enums as Postgres ENUMs: `task_status`, `task_priority`, `sprint_status`, `user_role`,
  `membership_source`.

## Tables

```sql
users (
  id            uuid pk,
  username      citext unique not null,
  password_hash text not null,              -- argon2id
  display_name  text,
  timezone      text not null default 'Asia/Tehran',
  theme         text not null default 'system',   -- light|dark|system
  role          user_role not null default 'admin',
  created_at    timestamptz not null default now()
)

sessions (                                   -- server-side, revocable
  id         uuid pk,
  user_id    uuid fk -> users,
  token_hash text unique not null,           -- sha256 of the cookie value
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
)

areas (
  id              uuid pk,
  user_id         uuid fk,
  name            text not null,
  color           text not null default '#6366f1',
  billable_default boolean not null default false,
  sort_order      int not null default 0,
  created_at/updated_at
)

projects (
  id         uuid pk,
  user_id    uuid fk,
  area_id    uuid fk -> areas not null,
  name       text not null,
  color      text,                            -- null = inherit area color
  sort_order int not null default 0,
  created_at/updated_at
)

tasks (
  id               uuid pk,
  user_id          uuid fk,
  area_id          uuid fk -> areas null,
  project_id       uuid fk -> projects null,
  title            text not null,
  description      text not null default '',
  notes            text not null default '',
  estimate_minutes int check (estimate_minutes > 0) null,
  priority         task_priority not null default 'medium',
  status           task_status not null default 'backlog',
  closed_at        timestamptz null,          -- set whenever status → Closed (reports §3)
  due_date         date null,                -- phase 6; Gregorian date, rendered Jalali
  recurrence_rule  jsonb null,               -- phase 6
  sort_order       int not null default 0,
  created_at/updated_at,
  constraint task_home check (not (area_id is not null and project_id is not null))
)

subtasks (                                   -- phase 6
  id uuid pk, task_id fk, title text, done boolean, sort_order int
)

tags (id uuid pk, user_id fk, name citext, unique(user_id, name))   -- phase 6
task_tags (task_id fk, tag_id fk, primary key (task_id, tag_id))    -- phase 6

sprints (
  id        uuid pk,
  user_id   uuid fk,
  name      text not null,                   -- «اسپرینت ۳۱ مرداد تا ۶ شهریور ۱۴۰۵»
  start_at  timestamptz not null,            -- Sat 00:00 user-TZ (stored UTC)
  end_at    timestamptz not null,            -- Fri 24:00 user-TZ
  status    sprint_status not null default 'active',  -- active | closed
  closed_at timestamptz null,
  created_at/updated_at,
  unique (user_id, start_at)
)

sprint_memberships (
  id        uuid pk,
  sprint_id uuid fk -> sprints,
  task_id   uuid fk -> tasks,
  source    membership_source not null default 'manual',  -- manual | carry_over
  added_at  timestamptz not null default now(),
  unique (sprint_id, task_id)
)

time_entries (
  id         uuid pk,
  user_id    uuid fk,
  task_id    uuid fk -> tasks not null,
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  minutes    int not null,                   -- denormalized (end-start) for fast sums
  note       text null,
  billable   boolean not null default false,
  created_at/updated_at,
  check (end_at > start_at and minutes > 0 and minutes <= 1440)
)

weekly_reports (
  id             uuid pk,
  sprint_id      uuid fk -> sprints unique,
  generated_at   timestamptz not null,
  schema_version int not null default 1,
  payload        jsonb not null              -- precomputed report sections
)
```

## Indexes

- `time_entries (user_id, start_at)` — timesheet week queries, report bucketing.
- `time_entries (task_id)` — task totals.
- `sprint_memberships (task_id)` — membership history; `(sprint_id)` from the unique key.
- `tasks (user_id, status)`; partial `tasks (due_date) where due_date is not null` (phase 6).
- Search (phase 6): `pg_trgm` GIN on `tasks.title`; description/notes via `to_tsvector('simple', …)`
  — Persian text: test both, pick in implementation.

## Notes

- `citext` for usernames/tags: case-insensitive uniqueness.
- Deletions are cascades configured per the FR-2.3/FR-3.2 confirmation flows (the API decides
  with the user, the DB cascades once the decision is made).
- `weekly_reports.payload` JSONB keeps the archived snapshot self-contained (EC-3: never
  recomputed silently).
- Denormalized `minutes` on entries is maintained by a trigger or in the service layer —
  service layer preferred (one write path through the API).
