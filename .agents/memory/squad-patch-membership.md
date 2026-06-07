---
name: Squad PATCH membership is intentional
description: Why any-member memberIds edits via PATCH /squads/:id are intended (not a bug), and how mobile should reconcile optimistic squad mutations.
---

# Squad PATCH membership + optimistic reconciliation

## PATCH /squads/:id memberIds is intentional — do not "fix" it
`PATCH /api/squads/:id` (api-server squads route) lets **any squad member** modify `memberIds` (add/remove), and fires member-added push notifications. A security audit will flag this as a privilege-escalation vs. the creator-only `POST /squads/:id/members`. It is NOT a bug to silently fix.

**Why:** it is covered by ~13 passing tests (`squads.pushNotifications.test.ts` → "PATCH /api/squads/:id — push notifications on memberIds change") that authenticate as a plain member (no `creatorId`) and assert success + notification behavior. Changing it is a product decision + test rewrite, not a clean-sweep fix.

**How to apply:** if you believe member-only membership management is desired, raise it with the user as a product change and update those tests deliberately — don't add a creator-guard on the side. Note `creatorId` IS enforced on `DELETE /squads/:id` (creator-only) and `POST /squads/:id/members` (creator-only); the inconsistency is known.

## Optimistic squad mutation failures: reconcile, don't reinsert
When an optimistic squad mutation fails (e.g. `leaveSquad` DELETE rejected), reconcile from the server via the existing silent `refreshSquads()` (GET /api/squads) rather than re-inserting a cached squad object.

**Why:** blindly re-adding a remembered object after failure can re-add a squad that a later/overlapping successful request already removed (stale restore). The server is authoritative. (The earlier `leaveSquad` bug was worse: it called full DELETE /squads/:id — deleting the whole squad for everyone — instead of DELETE /squads/:id/members/:self.)

**How to apply:** mobile AppContext has both `fetchSquads()` (with spinner) and `refreshSquads()` (silent). Use `refreshSquads()` on optimistic-failure catch paths.
