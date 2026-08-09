---
name: Squad member-list writes need a version CAS
description: Why writes to squads.member_ids must be compare-and-swap, why teardown must be one transaction, and why chat access is never inferred from participant rows.
---

# Writing `squads.member_ids` safely

Rewriting the whole member array from a JS snapshot is a lost update. Prefer an atomic SQL
expression (`member_ids || …`, jsonb minus). When the array really must be rewritten in JS, do it as
a compare-and-swap on `squads.version` inside a retry loop that **re-reads on every attempt**, and
give up with a 409 rather than forcing the write.

**Why:** two removals landing together each wrote their own stale snapshot, so one removed member
silently came back; the same shape erases a member who joined between the read and the write.

# Deleting the squad when the last member leaves must be ONE transaction

The version claim, the data purge, and the final delete belong in a single transaction. The claim's
UPDATE takes the row lock and holds it to commit, which is the only thing that actually blocks a
concurrent join — the join waits, then re-evaluates its WHERE against committed state and matches
nothing.

**Why:** claiming in a separate autocommit statement leaves a window where a join commits between
the claim and the delete, and the purge then destroys the squad the new member just joined.

**How to apply:** losing the claim inside the transaction must abort it (throw) so the purge rolls
back and the caller retries against fresh state. Anywhere a write can now find zero rows because the
row was deleted, distinguish "guard fired" from "row is gone" before replying — a 200 "you're in"
for a squad that no longer exists strands the client on a ghost.

# Chat access is never inferred from participant rows

`conversation_participants` rows are append-only (kept so old messages still resolve an author).
Removal must not delete them, so every read path decides access from CURRENT squad membership
instead.
