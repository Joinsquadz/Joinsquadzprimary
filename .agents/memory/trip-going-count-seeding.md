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

**How to apply:** the seeded-host rsvp is only enough for a "≥1 going" floor. Any
trip "attending"/"going" surface must count the ROSTER, not the rsvps map, or it
undercounts (shows only the host). Use `attendingIds(event, squadMemberIds)` in
`lib/eventUtils.ts`: for `type === "trip"` it returns unique(squad memberIds +
invitedUserIds + hostId); otherwise it falls back to rsvp-based `goingIds`. The
caller must supply the trip squad's memberIds (personal trips pass `[]`, still
counting host + invitees). The Home "Up Next" hero uses this for BOTH the avatar
pips and the count; TripCard shows no count; trip detail uses its own
`allTripMembers` roster. Backfilling existing trips =
idempotent `jsonb_set(rsvps, ARRAY[host_id], '"going"', true)` with `version+1`
(events.* JSON writes are version-checked).
