---
name: Ad-hoc & fresh availability polls
description: How "New plan — pick people" (ad-hoc) and "Find a time starts fresh" polls are scoped/authorized
---

# Ad-hoc availability polls (no squad / no event) + fresh-poll routing

A poll can be scoped three ways: `squadId`, `eventId`, or **ad-hoc** (neither).

- **`adhoc:true` is the discriminator, NOT a non-empty `participantIds`.** An ad-hoc
  poll with zero chosen friends is valid (a solo poll the creator shares by link).
  The server `CreatePollBody.refine` accepts `squadId || eventId || adhoc || participantIds.length>0`.
  If you gate ad-hoc on `participantIds.length>0` you 400 the "Start plan & share link" path.
- Roster for an ad-hoc poll = `[creator, ...participantIds]` (deduped), persisted to the
  `participantIds` jsonb column; `buildMembersField` renders from it.
- **Ad-hoc authz is intentionally open-by-UUID**, same as event polls: `canAccessAvailabilityPoll`
  returns true for any non-squad poll. The participant picker only *seeds the roster/invites* —
  it is NOT a security boundary. Do not "fix" this into a hard gate unless the product changes.

**Why:** ad-hoc plans are meant to be shared by link like event polls; requiring participants
or locking by participant set breaks the share-link UX.

## Fresh-poll routing

- Home "Find a time" ALWAYS opens a chooser and routes with `from=create`; the client maps
  `from=create` → `forceNew:true` so the server skips poll reuse and starts a brand-new board.
  Squad rows, "New plan", and event-create flow all pass `from=create`.

**How to apply:** any new entry point that creates a poll should pass `from=create` if it must
start fresh; ad-hoc entry must pass `adhoc:1` + `participantIds` (CSV) as route params, which
availability.tsx forwards as `{adhoc:true, participantIds}` in the POST body.

## Converted polls drop off EVERYWHERE

- A poll with non-null `convertedEventId` (resolved into an event/trip) must disappear from every
  "Existing" surface. The list route (`GET /availability/polls?squadId=|scope=personal`) already
  filters `convertedEventId IS NULL`, but the **event-scope chooser uses `findAvailabilityPoll`**,
  which must ALSO exclude converted rows in BOTH the eventId and squadId branches — otherwise the
  event chooser + squad CTA preview keep showing a poll that's already been turned into an event.

**Why:** locked product decision — once a poll converts, it's done and should not reappear as a
resumable "Existing" option. Trips are events under the hood, so they convert the same way.

**How to apply:** any new read path that surfaces a "current/latest poll" for a scope must filter
out converted polls, not just rely on `eventId IS NULL` / row existence.
