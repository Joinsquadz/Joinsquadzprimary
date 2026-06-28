---
name: Event/trip invite access invariant
description: How non-host access to events/trips is granted and the invariants the invite + accept flow must keep in sync
---

Non-host, non-squad-member access to an event/trip is granted ONLY via `events.invited_user_ids` — both `userCanAccessEvent` and the GET /events list query gate on it. The `event_invites` table is a pending/accepted workflow row, NOT the access source of truth.

**Invariant:** accepting an `event_invite` MUST append the user to `invited_user_ids` (accept handler does this). If those two drift (an `accepted` invite whose user is missing from `invited_user_ids`), the user silently has no access — symptom: "invite not working / accepted but can't see the trip."

**Why:** a real incident had an `accepted` invite with empty `invited_user_ids`, so the invitee had no access AND re-inviting silently no-opped (the unique `(event_id, invited_user_id)` row already existed → `onConflictDoNothing` dropped it → `inviteCount:0` fake success). Same dead-end blocked re-inviting a `declined` person.

**How to apply (POST /events/:id/invite):**
- Branch candidates: a target with an `accepted` row but missing from the array → REPAIR the array directly (don't re-invite). Everyone else → upsert to `pending`.
- The re-send upsert (`onConflictDoUpdate`) MUST carry `setWhere: status <> 'accepted'` so a concurrent accept (TOCTOU between the read and the upsert) is never downgraded back to pending.
- To repair existing drift across all events, reconcile `invited_user_ids` from each event's `accepted` event_invites (guard with a NOT-already-present EXISTS so versions aren't needlessly bumped).
