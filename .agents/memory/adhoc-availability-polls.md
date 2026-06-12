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

## Fresh-poll routing (T12)

- Home "Find a time" ALWAYS opens a chooser and routes with `from=create`; the client maps
  `from=create` → `forceNew:true` so the server skips poll reuse and starts a brand-new board.
  Squad rows, "New plan", and event-create flow all pass `from=create`.

**How to apply:** any new entry point that creates a poll should pass `from=create` if it must
start fresh; ad-hoc entry must pass `adhoc:1` + `participantIds` (CSV) as route params, which
availability.tsx forwards as `{adhoc:true, participantIds}` in the POST body.
