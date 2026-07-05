---
name: Squad PATCH membership is consent-gated
description: PATCH /squads/:id memberIds additions become pending invites (never direct adds), and how mobile should reconcile optimistic squad mutations.
---

# Squad PATCH membership + optimistic reconciliation

## PATCH /squads/:id memberIds additions become pending invites (July 2026 audit fix)
`PATCH /api/squads/:id` no longer directly adds members. Additions in `memberIds` are stripped from the persisted write and converted to **pending squad invites** (permission: `membersCanInvite || canManageSquad`, else 403). The invitee gets a "Squad invite" push (data `{screen:"activity"}`); existing members are NOT notified. Response includes `pendingInvitedUserIds`. Removals via PATCH still apply directly. Already-pending invitees are deduped (no duplicate invite, no push).

**Why:** the old any-member direct-add path was a consent bypass — the July 5 2026 audit flagged it, and joins everywhere else (invite accept, join-by-code, join-public) are consent/cap-gated. A legacy duplicate `POST /squads/:id/join` route with no cap check was also deleted.

**How to apply:** tests live in `squads.pushNotifications.test.ts` ("memberIds additions become pending invites" block; uses a FIFO `mockSelectQueue` + `mockUpdateSetArgs`). Mobile is unaffected — AppContext `updateSquad` patch type excludes `memberIds`. Don't reintroduce direct adds via PATCH; new membership paths must respect invite consent + FREE_SQUAD_LIMIT cap.

## Optimistic squad mutation failures: reconcile, don't reinsert
When an optimistic squad mutation fails (e.g. `leaveSquad` DELETE rejected), reconcile from the server via the existing silent `refreshSquads()` (GET /api/squads) rather than re-inserting a cached squad object.

**Why:** blindly re-adding a remembered object after failure can re-add a squad that a later/overlapping successful request already removed (stale restore). The server is authoritative. (The earlier `leaveSquad` bug was worse: it called full DELETE /squads/:id — deleting the whole squad for everyone — instead of DELETE /squads/:id/members/:self.)

**How to apply:** mobile AppContext has both `fetchSquads()` (with spinner) and `refreshSquads()` (silent). Use `refreshSquads()` on optimistic-failure catch paths.
