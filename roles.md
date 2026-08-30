# Roles & users

> Agent working notes — internal reference, not user-facing product documentation.

## Current reality (multi-user, live)

The owner is the only `admin`; they create `member` accounts in the **مدیریت** screen
(admin-only nav + `/admin` route, backend `require_admin`). Exactly one admin can ever exist —
the create API always yields `member` and cannot be given a role. Accounts can be edited
(display name, timezone), deactivated (`is_active=false`: login refused, sessions revoked,
data kept), have their password reset by the admin (sessions revoked), or deleted (whole
workspace cascades away; self-delete and admin-delete are blocked).

**Access model (decided with the owner, 2026-08-30):** admin manages **accounts only** — no
impersonation, no read access to other users' areas/tasks/sprints/logs. Each user's workspace
is fully private. Sharing/collaboration remains out of scope (see below).

## What replaced the old "Later" list

- ✅ Built: user management screen, admin password reset, account activation toggle.
- Still deferred: member invitations, sharing/collaboration. NOTE: sharing is NOT just
  flipping a role — it needs a workspace or sharing-target concept (share an area? a project?
  read vs write?). Revisit this file FIRST and decide the sharing model with the owner.

## Future permission sketch (placeholder, not a spec)

| Capability | admin | member (future) |
| --- | --- | --- |
| Own areas/projects/tasks/entries | ✓ | ✓ |
| See others' data | n/a | nothing (private model) |
| Manage own account settings | ✓ | ✓ |
| Server settings / other users | ✓ | ✗ |

The baseline assumption: **private model** — each user sees only their own data. Anything
shared would be a new design conversation (areas shared to specific users, role per share),
documented here before implementation.

## AuthN details (agreed)

- Username + password, argon2id hash.
- Server-side sessions in Postgres; cookie `planner_session`, HttpOnly, Secure, SameSite=Lax,
  ~30-day sliding expiry **[Proposal: 30d sliding]**.
- Login rate-limited (per-IP + per-username, e.g. 5/min backoff) **[Proposal]**.
- No self-registration; users created by admin only (even in the future).
- Password change + logout-all-sessions in profile settings (phase 7).
