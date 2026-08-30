# Overview — Personal Planner (working title)

> Agent working notes — internal reference, not user-facing product documentation.

## What this is

A lightweight, personal "mini-Jira": a web app for organizing life into areas, projects, and
tasks, with Tempo-style time tracking on a weekly calendar, fixed weekly sprints, and weekly +
monthly reports. Built for exactly one daily user now, with multi-user support designed in.

## Who uses it

- **Now:** the owner (admin) plus any members they create in **مدیریت**; everyone logs in with
  username + password and gets a fully private workspace.
- All interaction happens **through the web UI**. The user never touches files, configs, or
  Markdown as part of using the app.

## Goals

1. One place to manage all life areas (University, Freelance, Personal, …) with sub-projects
   (courses, client projects) and tasks.
2. Jira-like discipline without Jira weight: statuses, priorities, estimates, sprints, reports.
3. Time logging that matches real behavior: log after the fact on a calendar (drag a range,
   assign a task) — **no live timer**.
4. Weekly rhythm: sprint = week (Saturday → Friday); close the week, get the report.
5. Estimation feedback loop: estimate vs. actual on every report, so estimates improve.
6. Daily-use quality: fast, clean, pleasant, RTL-native Persian UI. Installable PWA.

## Explicit non-goals

- No team workflow features (assignments to others, approval flows, notifications spam).
- No file-based user features (no Markdown/PDF reports as files; reports are in-app pages).
- No public/anonymous access; login always required.
- No offline-first sync (PWA is installable but data is online).
- No mobile-native app.
- No invoicing/money calculations (only a billable flag on time entries).

## Product-defining decisions

| Topic | Decision |
| --- | --- |
| UI language | Persian only, full RTL |
| Calendar | Jalali (Solar Hijri) for all date display; weeks run Saturday → Friday |
| Digits | Persian digits (۱۲۳) for dates; Latin digits for clock times and durations (`02:30–04:00`, `1.5 ساعت`) |
| Statuses | `Backlog` → `Open` (on sprint add) → `In Progress` → `Closed`; manually changeable anytime |
| Priority | High / Medium / Low |
| Estimates | One estimate per task, in hours; confirmed/edited in the add-to-sprint dialog |
| Sprints | Fixed one-week (Sat→Fri), auto-created, closed manually with per-task decisions |
| Time logging | Weekly timesheet calendar page: drag-create / move / resize, 15-min snapping, overlaps allowed but visually flagged |
| Reports | Weekly snapshot generated at sprint close; monthly report per Jalali month (live computed) |
| Deployment | Docker images + docker-compose, runnable on any VPS |

## Success criteria (how we know it's good)

- The owner uses it daily for sprint planning + logging the week's time in one sitting.
- Weekly close takes < 5 minutes.
- Monthly report answers "where did my hours go?" without any manual bookkeeping.
- Estimates vs. actual trend becomes visible after 4–6 weeks of use.

See also: `requirements.md`, `glossary.md`, `roadmap.md`.
