---
name: Account deletion full purge
description: What a compliant DELETE /account purge must cover in SquadZ — relational rows AND embedded JSON AND denormalized fields.
---

# Account deletion full purge

`DELETE /api/account` must remove EVERY trace of a user, not just rows keyed by their id.

**Rule:** when adding any feature that stores a user id, audit the account-deletion purge for THREE storage shapes, not one:
1. Relational rows keyed by the user (memberships, photos, friendships, sessions, push tokens, reactions, etc.) — delete by `userId`.
2. **Embedded JSON arrays/maps** that nest the user inside *another* owner's row — e.g. `events.rsvps` (map key), `events.messages` (senderId), `events.tasks` (assigneeId), `events.polls[].options[].voterIds`, `events.costs` (paidById + shares[].userId). These are NOT caught by a delete-by-userId on the events table because the row belongs to a different host. Select non-owned rows that reference the user (`col::text LIKE %userId%` as a cheap candidate filter), scrub in JS, write back, and BUMP the row `version` (these JSON columns are under optimistic-concurrency checks).
3. **Denormalized "summary" fields** — e.g. `conversations.lastMessageSenderId` / `lastMessagePreview`. Deleting the underlying message leaves a stale snapshot pointing at the deleted user; recompute from the newest surviving child row (or blank it).

**Why:** the architect failed an account-deletion review because only shape #1 was handled; shapes #2 and #3 left the deleted user's content/ids lingering in other users' events and squad conversation previews — a real app-store/GDPR "delete all my data" gap.

**How to apply:** Stripe cancel is best-effort OUTSIDE the tx (log, never block). Everything else runs in one `db.transaction`, user row deleted LAST (cascades auth_tokens). Squad ownership uses the squads.ts "B1" transfer-to-longest-standing-member rule (member_ids kept in join order → updated[0]). For shared financial data (costs), remove the leaving user's entries (paid + owed share) but leave OTHER members' shares intact so remaining splits don't corrupt.
