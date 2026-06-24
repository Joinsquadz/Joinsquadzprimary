---
name: Trip "going" count seeding
description: Why trips must seed the host into rsvps at creation but events must not
---

Trips have NO RSVP UI (access is live-squad-membership based and deliberately
ignores the rsvps map), but the home screen "going" count is still derived from
`event.rsvps` (mobile `goingCount` in `lib/eventUtils.ts`). So a freshly created
trip with empty rsvps shows "0 going" even though the organizer is attending.

**Rule:** On `POST /api/events`, seed `rsvps = { [hostId]: "going" }` ONLY when
`type === "trip"`. Plain events must NOT seed the host — they expose an RSVP
toggle and intentionally start the host at `myRsvp == null` to prompt them.

**Why:** matches user expectation ("organizer should be 1 going") without a trip
RSVP UI; safe against the trip access model because trip authz never reads rsvps,
and `getEventParticipantIds` already includes hostId regardless.

**How to apply:** any new "attending"/"going" surface for trips should rely on
the seeded host rsvp, not invent a parallel count. Backfilling existing trips =
idempotent `jsonb_set(rsvps, ARRAY[host_id], '"going"', true)` with `version+1`
(events.* JSON writes are version-checked).
