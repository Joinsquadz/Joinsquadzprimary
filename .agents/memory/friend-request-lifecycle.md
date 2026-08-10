---
name: Friend request lifecycle & block precedence
description: Why friend-request writes must be an upsert, and why a block has to be re-checked at accept time, not only when the block is placed.
---

# Friend requests are one row per (from, to) — forever

The friend_requests row is UNIQUE on (from_user_id, to_user_id) **regardless of
status**, so a pair gets exactly one row for the lifetime of the app.

**Rule:** every "send a friend request" write must be an upsert that revives the
existing row (`ON CONFLICT ... DO UPDATE SET status='pending'` with a `setWhere`
that skips rows already pending), never a plain insert.

**Why:** a plain insert throws on the second request for the same pair — which is
every re-request after a decline, and every re-request after two people unfriend
(the accepted row is still there). Both are ordinary user behaviour and both
surfaced as a 500. The `setWhere` also makes two simultaneous taps degrade to a
clean duplicate response instead of a constraint crash.

**How to apply:** any new path that creates a friend request (roster badge, deep
link, import-contacts, admin tooling) inherits this. Returning no row from the
upsert means "already pending", not "failed".

# A block outranks any request that predates or races it

**Rule:** blocking is checked in three places, not one — before sending, after
the request row is committed, and again at the moment of acceptance.

**Why:** the block route cancels the pending requests it can *see*. A request
committed in the same instant is invisible to that pass and survives, so the
blocker later finds a live request from someone they blocked — and accepting it
manufactures a friendship (which in turn re-opens DMs) between two people who
have blocked each other. The sender re-checking after its own write withdraws
the losing row; the accept-time check catches anything that still slips through.

**How to apply:** the same "re-check at the moment of the privileged action"
shape applies to any relationship a block is supposed to sever — treat the
block table as authoritative at action time, never as a one-shot cleanup.
