# Sprints — lifecycle & rules

> Agent working notes — internal reference, not user-facing product documentation.

## Shape

- Fixed one-week sprints: **Saturday 00:00 → Friday 24:00** in the user's timezone.
  No custom-length sprints (agreed). One sprint per week, auto-created **[Proposal: auto-create
  on first access/cron; the owner never creates sprints manually]**.
- Name: «اسپرینت ۳۱ مرداد تا ۶ شهریور ۱۴۰۵» (Jalali range) **[Proposal — alternative was a
  Jalali week number; range is more readable]**.
- `status`: active → closed (manual close, reopen allowed).

## Status lifecycle within a sprint

```
create task ──────► Backlog                    (default, anywhere in the app)
add to sprint ────► Open                       (automatic nudge, only from Backlog)
start work ───────► In Progress                (manual; also via column drag on Sprint page)
finish ───────────► Closed                     (manual; also via column drag; "close anyway" at close)
```

- Transitions are never enforced — any manual change is allowed (agreed: "Flexible").
- The automatic part is ONLY: joining a sprint while in Backlog flips to Open.
  EC-5: adding an Open/In Progress/Closed task never downgrades its status.
- Logging time does NOT change status and does NOT require sprint membership.
- Remove from sprint: Open → Backlog; In Progress/Closed unchanged (EC-6).

## Membership

- `(sprint, task)` unique; multi-sprint membership over time is normal (carry-over history).
- Adding while already in another active sprint: allowed with warning (EC-4).

## Close flow (the weekly ritual)

1. «بستن اسپرینت» (offered from Saturday of the following week **[Proposal]**).
2. Review dialog:
   - Finished (Closed) tasks: listed for confirmation.
   - Unfinished (Open / In Progress) tasks: one decision each —
     a. **انتقال به اسپرینت بعدی** (carry over): new membership in next sprint (auto-created),
        `source=carry_over`, status kept as-is (Open stays Open, In Progress stays In Progress).
     b. **بازگشت به بک‌لاگ**: membership ends, status → Backlog.
     c. **بستن** (close anyway): status → Closed.
   - Summary: total logged hours, billable share, count per decision (defaults preselected:
     carry-over for Open, keep In Progress as carry-over **[Proposal]**).
3. Confirm → decisions applied → weekly report snapshot generated → sprint closed → navigate
   to the archived weekly report.
4. Reopen (undo) allowed until the NEXT sprint is closed; re-closing regenerates the snapshot.
   After the next sprint is closed, the sprint stays closed **[Proposal — keeps week-over-week
   chain sane]**.

## Weekly report inclusion rule **[Proposal — verify with owner at doc review]**

A time entry belongs to a sprint's report iff:
- entry `start_at` (converted to user TZ) falls within the sprint's Sat 00:00 → Fri 24:00, AND
- the entry's task has a membership in that sprint (any source, any date added).

Rationale: matches how the owner works — tasks added to the week's sprint, time logged during
that week, possibly late. Entries logged after close still satisfy the rule for the LIVE
monthly view, but the archived snapshot is frozen (EC-3).

## Auto-creation mechanics

- Idempotent `ensure_current_sprint(user)` called from sprint/timesheet endpoints and a daily
  internal tick; creates the sprint row for the ongoing week if missing (name from Jalali).
- Next week's sprint may be created early by a carry-over decision — same helper, target week.
