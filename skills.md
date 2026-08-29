# Skills — lessons & reusable patterns

> Agent working notes — my own journal for THIS project. Entries I add as I learn things
> during planning/implementation, so future-me (and future sessions) can reuse them.

## Jalali (Solar Hijri) calendar

- **Never hand-roll Jalali conversion.** 33-year leap cycle, month lengths 29–31. Use
  `date-fns-jalali` (frontend display/format) and `jdatetime` (Python, server-side strings
  only, e.g. sprint names + report snapshot labels).
- Persian weeks start **Saturday**. All "week" bucketing = Sat 00:00 → Fri 24:00 in the USER's
  timezone, not UTC (EC-10).
- Month lengths vary; monthly recurrence needs clamping to the last valid day.
- Weekday constants: Python `weekday()` → Sat=5, Sun=6; JS `getDay()` → Sun=0, Sat=6.
  Isolate both in one helper module each; never inline the magic numbers.
- Jalali month names for UI: فروردین، اردیبهشت، خرداد، تیر، مرداد، شهریور، مهر، آبان، آذر،
  دی، بهمن، اسفند. Never use Gregorian month names in the UI.

## RTL Persian UI

- `<html dir="rtl" lang="fa">` + CSS **logical properties** only (`ms-/me-/ps-/pe-/start-/end-`
  in Tailwind). Any hardcoded left/right will break under RTL review.
- **Never put Persian text inside the `.tnum` class** (direction:ltr) — it scrambles mixed
  word/number order. `.tnum` is only for Latin-digit numeric data (clock ranges, durations).
  First real bug from this: the timesheet week label read unnaturally; fixed with a proper
  Persian range formatter (`faDateRange` → «هفته‌ی ۷ تا ۱۳ شهریور ۱۴۰۵», collapsing shared
  month/year) plus removing the forced LTR.
- Directional icons (chevrons/arrows/indent) must be mirrored; non-directional icons must not.
- **Calendar grids are natively RTL**: Saturday goes at the right edge by building the grid in
  DOM order under `dir=rtl` — do NOT reverse arrays in JS.
- **RTL arrow navigation convention (owner-confirmed)**: rightmost button = `ChevronRight` =
  **previous** (past sits to the right), leftmost = `ChevronLeft` = **next**. First DOM child
  renders rightmost under RTL flex — wire actions accordingly. Reference implementation:
  timesheet week nav; the Reports month nav originally had the two handlers swapped. Keep the
  convention identical across all paginators (reports month, month-picker year, timesheet week).
- Drag/drop uses pointer coordinates → unaffected by RTL. Column REordering (kanban) flows
  right-to-left: first status at the right.
- Font: **Vazirmatn** (OFL, self-host via @fontsource or woff2 in repo), weights 300–700.
- Digits policy (agreed): dates via `Intl.NumberFormat('fa-IR')`/locale-aware formatting →
  Persian digits; clock times + durations stay Latin with tabular alignment. Centralize in
  one `format.ts` so components never call `Intl` directly.
- **Duration format (owner decision, 2026-08-29, final):** compact Latin `1h 15 min` /
  `2h` / `45 min` via `fmtDuration` — NEVER decimal hours, and NOT spelled-out Persian
  «ساعت و دقیقه» (owner rejected it as clunky; also an earlier template-literal typo leaked a
  stray `}` into rendered text — check rendered output, not just types). Estimate/log inputs
  use compact `h:mm` (`hmOf` + `parseDurationInput`, which also accepts legacy decimal like
  `2.25`). Every duration shown anywhere flows through `fmtDuration` — no ad-hoc math in
  components. **Duration pairs (logged vs estimate) use the slash form — `1h 15 min / 2h` via
  `fmtEstimateLogged` — never «از» between two Latin runs** (bidi-mixing looks broken; owner
  decision 2026-08-29). Reports estimate-vs-actual rows follow the same `X / Y` pattern.
- Persian text search: try `pg_trgm` vs `to_tsvector('simple', …)` during phase 2/6; Persian
  morphology is hard — contains-match may be the honest baseline.

## Timesheet drag-and-drop (phase 4 prep)

- dnd-kit is built for discrete card dragging (kanban), not continuous grid resizing — for a
  Tempo-like week grid, a **custom pointer-events implementation** (pointerdown/move/up +
  snapping math on a CSS-grid overlay) is likely simpler and more accurate.
- Candidates to evaluate in the phase-4 spike: custom grid, `react-big-calendar` (check RTL +
  Jalali pain), `@schedule-x`. Decide AFTER a spike, record results here.
- Snap math: round pointer delta to 15-min increments against an hour-row height constant;
  keep all math in minutes, convert to/from pixels in one adapter.

## FastAPI + React + auth

- Same-origin serving (Caddy serves SPA + proxies `/api`) removes CORS entirely — prefer this
  over dev-style CORS configuration; in dev use Vite's proxy to localhost:8000.
- Server-side sessions (table + hashed cookie token) beat JWT for a self-hosted app: real
  logout/revocation, no refresh-token machinery.
- argon2id via `argon2-cffi`; rate-limit login before hashing (cheap rejection first).

## Process / collaboration (this project's ground rules)

- The owner wants **co-decision**: explain options → ask → approval → only then final. Never
  silently pick between meaningfully different behaviors.
- The `.md` files here are MY memory, not deliverables. The user sees everything through the
  app UI only.
- Update `decisions.md` BEFORE coding when a decision changes; update this file the moment a
  lesson is learned.
- Every ambiguous spec point I resolve by myself gets an explicit **[Proposal]** marker so the
  owner can veto at review — proposals are cheap to change now, expensive after code exists.

## Implementation-phase lessons (2026-08-29)

- **Jalali without date-fns-jalali worked well**: vendored jalaali-js (~120 lines) +
  `Intl.DateTimeFormat(...).formatToParts` for zoned parts. Pattern that mattered: represent
  the week as 7 *wall-clock date-parts* (pure math), convert each to a UTC instant with a
  two-pass offset resolution (`zonedPartsToUtc`). Never mix browser-local getters into it.
- **RTL timesheet layout**: CSS grid `56px repeat(7,1fr)` puts the time gutter on the RIGHT
  automatically under `dir=rtl`; day 0 (شنبه) = rightmost. Absolutely-positioned entry blocks
  use `insetInlineStart: lane*(100/laneCount)%` so lanes also flow RTL. Drag math uses
  `getBoundingClientRect` + `dayIndexFromX` scanning col rects (index order = DOM order = RTL
  visual order) — no mirroring needed anywhere.
- **react-multi-date-picker**: `DateObject` (value class) is the *default* export of
  `react-date-object`; the `DateObject` *type* is exported by `react-multi-date-picker`;
  `calendar`/`locale` props come from `react-date-object/calendars/persian` + `/locales/persian_fa`.
  Don't import both under the same name.
- **FastAPI ≥0.12x lazy router inclusion**: `app.routes` shows `_IncludedRouter` placeholders,
  so counting routes misleads — verify via the OpenAPI schema or an actual request.
- **`tsc -b && vite build`**: keep `noUnusedLocals` off while drafting fast; strict mode still
  caught real bugs (non-null assertions hiding undefined paths in drag handlers).
- **TestClient + FastAPI lifespan**: startup (create_all/seed) only runs inside
  `with TestClient(app)`; a bare `TestClient(app).get(...)` skips it.
- **pytest ordering**: alphabetically-scoped session DB needs per-test truncation — truncate
  all entity tables (keep users+sessions) in an autouse teardown; keeps each test hermetic.
- **JSONB payload columns**: anything stored (report snapshots) must pass through a jsonable
  helper (UUID→str, datetime→ISO) — psycopg3 json.dumps rejects UUID.
- **This VPS's network**: system pip points at a dead Iranian mirror → always
  `pip install -i https://pypi.org/simple/`; npm to registry.npmjs.org works but flaky →
  `--fetch-retries=6 --fetch-retry-maxtimeout=60000` (and the same flags in the caddy build).
- **compose healthchecks**: `depends_on: condition: service_healthy` with `pg_isready` gives
  reliable backend startup ordering; backup sidecar reuses the postgres image.

## To investigate

- [x] Jalali date picker: react-multi-date-picker chosen and working (persian calendar + fa locale)
- [x] Timesheet grid approach: custom pointer-events implementation (spike done implicitly via build)
- [x] Persian text search: ILIKE contains-match shipped as baseline (pg_trgm/tsvector deferred)
- [x] pg_dump restore drill — DONE: restore.sh pipeline verified against a scratch DB (12 tables)
- [x] Timezone edge: Asia/Tehran is +03:30 fixed since 2022; IANA zone math used throughout
- [x] Telegram from this VPS: BLOCKED (DNS interception + IP block). Backup Telegram channel is
      env-activated and will work on the owner's planned external server.

## Hard-won lessons (build/deploy phase)

- `python:3.12-slim` is now **Debian trixie** — a `bookworm-pgdg` apt line breaks (libpq
  conflict). Use `trixie-pgdg`.
- **pg_dump client major must be ≤ server major**: client 18 dumps fine but the SQL contains
  `SET transaction_timeout` which PG16 rejects at restore. Pin `postgresql-client-16` from PGDG.
- Always run a REAL restore drill before trusting a backup feature — the above two were only
  caught by loading the dump into a scratch database.
- When a curl chain suddenly 401s, remember the owner may have changed their password in the
  UI while testing. Verify via in-container `run_backup` instead of guessing credentials.
- GitHub backup delivery = Contents API PUT with base64 content (no git binary needed in the
  container); fine-grained PAT scoped to the single repo.

## To investigate (during implementation spikes)

- [ ] Jalali date picker: `react-multi-date-picker` quality/RTL/a11y (phase 2 spike)
- [ ] Timesheet grid approach spike (phase 4) — see note above
- [ ] Persian text search: trigram vs tsvector (phase 2/6)
- [ ] `pg_dump` restore drill (phase 1) — verify the documented restore command actually works
- [ ] Timezone edge: DST — Iran abolished DST in 2022; `Asia/Tehran` is now +03:30 fixed,
  but keep using IANA zone math, never fixed offsets
