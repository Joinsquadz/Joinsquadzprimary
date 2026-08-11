---
name: Free-tier cap ledgers (squads & plans)
description: Why squad/plan caps count append-only ledgers instead of live rows, and the invariants every new join path must honor.
---

Free-tier caps are counted from **append-only ledgers**, never from live state. Squads and
plans each have one; events and trips share a single pool (a trip is an event row), on a
rolling 12-month window.

**Why:** counting live membership let a free user cycle join → leave → join forever and
never hit a cap. A membership is a slot you SPEND, not a seat you rent. So leaving refunds
nothing, and a pending invitation charges nothing — you haven't participated yet.

**How to apply — any new path that makes a user a participant:**
- Claim a slot on create, join-by-code, invite accept, and RSVP "going". `maybe`/`notgoing`
  must not charge; undecided is not participation.
- The participation write must run **inside** the claim's transaction — both or neither.
  Claim-then-write in two transactions is a real bug, not a theoretical one: the loser of
  two simultaneous accepts writes nothing, so a pre-committed claim charged it anyway.
- Gate the charge on the write actually landing (a row array from `.returning()`, not a
  bare update result — that silently degrades to "always charge"). Zero rows means the
  target vanished or a concurrent writer won, and must cost nothing. Make the membership
  append conditional so zero rows genuinely means "already in / gone".
- Distinguish the two zero-row cases inside the tx: "already a member" is an idempotent
  success; "deleted mid-flight" must roll the accept back (throw, don't return) so the
  invite is not left accepted into something that no longer exists.
- A claim for an existing (user, target) must be a no-op that passes **even when the user
  is over the cap** — otherwise re-RSVPing starts failing for grandfathered users.
- Take the per-user advisory lock **before** the "already claimed?" probe. Probing first
  lets a concurrent re-claim read no row, block, and then be judged against a count its own
  twin just incremented — rejecting what should be free.
- Users already over a cap keep everything; caps only block *new* additions, and count
  endpoints report the true count rather than clamping to the limit.
- Moving an existing model onto a ledger needs an idempotent backfill plus duplicate
  cleanup before the unique index can be created.
