# UX flows & screen behavior

> Agent working notes — internal reference, not user-facing product documentation.
> UI text will be Persian; this file describes behavior. RTL rules at the bottom are binding.

## App shell

- **Desktop**: sidebar on the **right** (RTL) with nav: اسپرینت · تایم‌شیت · گزارش‌ها ·
  همه تسک‌ها · حوزه‌ها. Topbar: global search (phase 6), theme toggle, user menu.
- **Mobile**: bottom tab bar with the 5 nav items; page headers carry contextual actions.
- Area colors as subtle accents (sidebar chips, entry blocks, badges) — not full themes.

## Sprint page (اسپرینت) — default landing

- Header: sprint name (Jalali range), date range, progress bar (logged vs sum of member
  estimates), counts (Open/In Progress/Closed), «بستن اسپرینت» button (visible from Saturday
  of the following week onward — or always with a confirm **[Proposal: from Sat onward]**).
- Task board: three status columns — باز / در حال انجام / انجام شد — drag between columns to
  change status (optimistic). Backlog tasks are NOT shown here (they live in All Tasks).
- «افزودن تسک» opens the picker modal: search/filter by area/project/tag; Backlog tasks
  highlighted; multi-select; then the estimate step per selected task (prefilled, editable).
- Task cards: title, area/project chip, priority badge, estimate, logged (e.g. `1.25 / 2`),
  due-date flag (phase 6), overdue styling (phase 6).
- Carried-over tasks carry a small «انتقال‌یافته» badge (source=carry_over).
- Click card → task detail drawer (FR-4.5).

## Timesheet page (تایم‌شیت) — the core logging surface

- Toolbar: «هفته‌ی ۳۱ مرداد تا ۶ شهریور ۱۴۰۵» label, ‹ previous, next ›, «امروز» jump button.
- Grid: 7 day columns (شنبه at the RIGHT edge — see RTL rules), hours 00–24 as rows; current
  time indicator line on today's column.
- Entries: blocks colored by task's area (or project color, fallback area), text = task title
  + duration (`02:30–04:00 · 1.5 ساعت`... keep to `1.5 ساعت` inside block, full range in tooltip).
- **Drag on empty grid** → live size preview → on release, create modal: time range prefilled
  (editable), task picker (recent tasks first, searchable, grouped by area/project), note,
  billable toggle (prefilled per area default) → create → status of chosen Backlog task
  is NOT changed by logging (logging ≠ sprint membership).
- **Click entry** → edit modal: same fields + delete (confirm).
- **Drag entry** → move (same day or across days); **resize edges** → change duration; snap 15 min.
- **Overlap flag**: entries overlapping share width and get amber outline; day column with
  >24h total gets a warning footer.
- Day headers: «شنبه ۳۱ مرداد» + day total (`6.25 ساعت`) + billable share if any.
- **Mobile** [Proposal]: day view by default with swipe left/right between days, week overview
  as a read-only compact list; tap empty slot → create modal with time steppers instead of drag.
- Past/future weeks fully navigable; logging into any week is allowed (late logging, EC-1/FR-5.5).

## Reports page (گزارش‌ها)

- Month selector: «مهر ۱۴۰۵» with ‹ › navigation and a Jalali month picker dropdown.
- Summary cards: total hours, billable hours, tasks completed.
- Sections (see `reports.md` for definitions): per-area table with expandable project rows ·
  task-level breakdown · completed tasks · estimate vs actual.
- Week strip: the 4–5 sprints overlapping the month, each linking to its weekly report view
  («هفته‌ی ۳۱ مرداد – ۶ شهریور: 18.5 ساعت»).
- Weekly report view (archived snapshot): same four sections, header notes the close time
  («بسته‌شده در جمعه ۶ شهریور ساعت 21:40») and a hint that later edits don't change it (EC-3).

## All Tasks page (همه تسک‌ها)

- Filter bar: area, project, status, priority, tag (phase 6), due (phase 6), text search.
- Rows: title, area/project chips, priority badge, status chip, estimate / logged, sprint chip
  (current sprint membership), due (phase 6). Sorted by: manual order within status groups
  [Proposal], or updated desc — toggle.
- Inline quick-add at top: type title + Enter → standalone Backlog task (then editable in
  detail). «+ تسک جدید» opens full form with parent selector (Area / Project / standalone).
- Bulk actions **[not planned]** — skip unless asked.

## Areas page (حوزه‌ها)

- Card per area: color dot, name, projects listed under it, counts (tasks, hours this week),
  edit/delete. «حوزه جدید» dialog: name, color, billable default toggle.
- Inside an area card: add project, add area-level task shortcuts.

## Task detail drawer (from Sprint / All Tasks / Timesheet edit)

- Fields editable in place: title, description, notes (textarea), parent selector (move
  between project/area/standalone), estimate, priority, status select, due (phase 6),
  recurrence (phase 6), tags (phase 6).
- Subtask checklist with add/checkbox/reorder (phase 6); progress on parent rows.
- Time section: total logged vs estimate + per-entry list (date Jalali, range, note, billable
  badge) + «ثبت زمان» quick-log form (Jalali date picker, start/end times, note) — bypasses
  the calendar when you know the numbers.
- Membership history: «اسپرینت‌ها: ۳۱ مرداد–۶ شهریور (انتقال‌یافته)».
- Danger zone: delete task (FR-4.6 warning when hours exist).

## First-run experience

- No areas → Areas page shows onboarding card (create first area); Sprint page shows
  «اسپرینت این هفته خالی است — افزودن تسک» empty state; Timesheet shows an illustrative hint
  overlay (dismissable) for drag-to-create.

## RTL & typography rules (binding)

- `<html dir="rtl" lang="fa">`. Font: **Vazirmatn** self-hosted, weights 300–700.
- Tailwind logical utilities ONLY (`ms-/me-/ps-/pe-/start-/end-/text-start/end`); no
  `left/right` CSS; directional icons (arrows, chevrons, indent) mirrored via
  `rtl:-scale-x-100` or icon swaps.
- **Calendar column order: شنبه at the right** — the grid is built RTL natively (flex order
  follows dir), NOT reversed with CSS tricks. Times column sits at the right edge, days
  flowing شنبه → جمعه right-to-left.
- Drag interactions unaffected by RTL (pointer coordinates, not layout).
- Digits per `glossary.md`: dates `جمعه ۶ شهریور ۱۴۰۵` (Persian digits via fa-IR Intl),
  times/durations Latin (`02:30–04:00`, `1.5 ساعت`, tabular alignment).
- Buttons/dialogs: primary action on the left end (mirrored from LTR convention); destructive
  actions visually separated (red text, confirm dialogs).
- Kanban/status columns flow right-to-left: باز rightmost, انجام شد leftmost.
