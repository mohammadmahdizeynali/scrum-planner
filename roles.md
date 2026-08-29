# Roles & users

> Agent working notes — internal reference, not user-facing product documentation.

## Current reality

Exactly one user: the owner. Login required (agreed). Role: `admin`. The admin is the only
role that exists in the UI initially — there is no user management screen in phase 1.

## Multi-user readiness (designed in, not built out)

The owner explicitly wants login + multi-user in mind from the start. What we do NOW vs LATER:

**Now (cheap, non-breaking):**
- `users` table with `role` (admin | member) — admin is the owner.
- Every owned row carries `user_id`; all queries filter by the session user. This is the
  real multi-user preparation: strict ownership scoping from day one, no "global data" paths.
- Sessions table with expiry — revocation works per-user.
- Seeding: first boot creates admin from env if no user exists.

**Later (explicitly deferred — do not build):**
- Member invitations, user management screens, password reset flows.
- Sharing/collaboration. NOTE: sharing is NOT just flipping a role — it needs a workspace or
  sharing-target concept (share an area? a project? read vs write?). When the owner asks for
  a second user, revisit this file FIRST and decide the sharing model with them.

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
