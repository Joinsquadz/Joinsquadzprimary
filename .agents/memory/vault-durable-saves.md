---
name: Vault durable saves ("Save to my vault")
description: Why a personal save copies bytes instead of referencing the source, and the ordering/authz/cleanup rules that keep it durable.
---

"Save to my vault" is **not** a favorite. A favorite is a reference that dies with the
source row. A save must survive deletion of the source photo, its event, and its squad.

**Why:** users treat "saved" as "mine forever". A reference-based save silently empties
people's vaults whenever a squadmate cleans up their photos or a squad is torn down.

**How to apply:**
- A save copies the storage object and inserts a new photo row owned by the saver with no
  event/squad linkage. The link back to the source is deliberately **not** a foreign key —
  a cascade (or SET NULL) would defeat the entire point. It exists only for idempotency and
  the saved badge.
- Never point the copy at the source's object path. Photo URLs are globally unique anyway,
  so "reuse the source URL" is not a legal fallback for any case: media with no private
  object to copy (public/legacy URLs) must be **refused explicitly**, not saved by
  reference and not left to blow up on the unique constraint.
- Record upload provenance **before** inserting the row. Media ownership is resolved from
  provenance, never from a path prefix, so a row whose bytes were never recorded orphans
  those bytes past the owner's account purge. If the object copy fails, insert nothing.
- Authorize on live "can you view this right now" plus a hidden/moderated check, evaluated
  at save time — someone removed from the squad can no longer save.
- Idempotency needs a **unique constraint**, not just a probe: two simultaneous saves both
  pass the probe. The insert conflicts, the loser releases the object it copied for nothing
  and returns the winner's row.
- A save allocates three things (object bytes, provenance row, photo row), so un-save must
  release all three or every save/un-save cycle leaks a private object and leaves
  provenance pointing at bytes nothing references. Guard the byte delete on "no surviving
  row references this URL", and let a failed delete fall into the retry queue rather than
  failing the user's request.
- The personal vault (roll-up **and** saves) is the paid entitlement; the shared squad
  vault is free for members. Enforce it server-side on every save endpoint — a UI-only gate
  lets a free user bank copies via the API and keep them until upgrade. Removal stays free
  so a downgrade never traps bytes.

## Client: "Saved" is a claim about the server, so don't say it optimistically

- Optimistic UI is wrong for this one action. Every other toggle (heart, favorite) can
  flip instantly because a lost one costs nothing, but "Saved to your vault" tells someone
  their photo is now safe forever — say it only after the server confirms, and show a
  pending state in between. A rolled-back optimistic save is indistinguishable from a real
  one until they come back and find it missing.
- A pending state that isn't disabled invites a second tap, which reads as an UN-save of a
  save still in flight. Track in-flight source ids and make the control inert while a
  request is open.
- Re-read the saved set from the server after a save instead of inferring it: the server
  may treat the write as idempotent (already saved via another surface), and inference
  drifts from that.
- Refresh only the grid the current screen actually holds. A contextual mount (squad/event
  vault) has no personal list in state, and the personal mount re-fetches when it opens, so
  reaching for a cross-screen refresh helper is unnecessary — and the helper doesn't exist.
