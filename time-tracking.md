# Time tracking — timesheet & entries

> Agent working notes — internal reference, not user-facing product documentation.

## Philosophy (agreed)

No live timer. The owner logs after the fact, Tempo-style: open the week, drag the ranges
worked, assign tasks. This must be low-friction enough to do once a day or once a week.

## Time entry (the atom)

| Field | Rules |
| --- | --- |
| Task | Required. Any task: project, area-level, or standalone. Searchable picker, recents first. |
| Start / End | Absolute timestamps; stored UTC; input in user TZ; `end > start`; duration ≤ 24h (EC-2). |
| Note | Optional free text («تمرین فصل ۳», client call summary). |
| Billable | Boolean; default from the task's area `billable_default` (Freelance areas true) **[Proposal]**. |

- Every entry is editable/deletable forever (past weeks, closed sprints — EC-3).
- Entry creation does not touch task status or sprint membership.
- `updated_at` kept for audit; no full edit history **[Proposal]**.

## Timesheet interactions (week grid, شنبه → جمعه, RTL)

- **Create**: drag down on empty space → release → create modal prefilled with the snapped
  range. Live preview block while dragging.
- **Snap**: 15 minutes **[Proposal]** for create/move/resize.
- **Move**: drag a block to another slot/day. **Resize**: grab top/bottom edge (RTL does not
  affect vertical gestures; day columns reorder naturally with dir=rtl).
- **Edit**: click block → modal (task, range, note, billable, delete).
- **Overlaps**: allowed. Rendering: split width within the day; amber outline + a day-total
  warning if the column sums over 24h (EC-2). No data prevention — reports always sum raw
  durations (agreed: "Allow + warn visually").
- **Week navigation**: ‹ / › / «امروز»; deep-linkable (`/timesheet?week=1405-06-01` style
  Jalali param or ISO internal — URL uses Jalali display, state uses date).
- **Current time line** on today's column.
- **Mobile** **[Proposal]**: day view default, swipe between days; tap slot → modal with time
  steppers (no drag); a compact read-only week overview above the day view.

## Quick-log (task detail form, no calendar)

- Jalali date picker + start/end time inputs (or duration stepper) + note + billable.
- Validates the same rules; useful for «yesterday morning» logging without hunting slots.

## Roll-ups (definitions — used by task pages AND reports)

| Scope | Sum of |
| --- | --- |
| Task | all its entries |
| Project | entries of tasks whose `project_id` = project |
| Area | entries of the area's projects' tasks **+** the area's area-level tasks |
| Standalone | their own entries only; shown as a "بدون حوزه" group in breakdowns |
| Sprint | entries with start inside the sprint range whose task is a sprint member (see `sprints.md`) |
| Month | entries with start date (user TZ) inside the Jalali month |
| Billable | filter of any of the above by `billable = true` |

- Attribute by **entry start date** (midnight-crossing entries count once, EC-1).
- Display: decimal hours Latin digits (`1.5 ساعت`), minute-precision internally.

## Validation summary

- `end > start`; duration ≤ 24h; snap on UI actions but API accepts any minute-aligned times
  (programmatic edits stay honest).
- Deleting a task cascades its entries (FR-4.6 confirm shows hours lost).
