---
name: Event/trip squad attachment must be membership-checked
description: Why squadId on plan create and plan update is authorized against live squad membership, and why squadName is never taken from the client.
---

# A plan's squadId is an access-control edge, not a label

Both plan CREATE and plan UPDATE (the host-only "move to a different squad"
path) must resolve the target squad and require the actor to be a CURRENT
member of it. Missing squad → 404, non-member → 403.

**Why:** plan visibility is derived from `squadId` (see the shared visibility
rule — current squad membership grants access). An unchecked `squadId` therefore
lets a caller push a plan into a squad they are not in: it appears in that
squad's feed and its chat audience is re-derived from that squad's roster. The
other half of the bug is a squad id that doesn't exist, which strands the plan
against a dangling reference nobody — including the creator — can resolve, while
the UI still renders whatever `squadName` the client supplied.

**How to apply:** always derive the denormalized `squadName` from the squad
record after the membership check; never persist the client's value. Clearing
the squad (empty string) is the only branch that skips the lookup and resets the
name to "Personal". Any future route that writes `squadId` onto a plan needs the
same two checks — the Zod schema alone can't express them.

# Sub-resource mutations must verify the sub-resource exists

Mutating a member of a JSON array column (tasks, and by extension any similar
embedded list) via read-modify-write silently no-ops when the id isn't found:
the map leaves the array unchanged, the row is still rewritten, and the version
still increments. The client gets 200 + a bumped version for an edit that never
happened — most often because a collaborator deleted that item moments earlier.

**Why:** the version CAS protects against concurrent writes, not against a
target that no longer exists; those are different failure modes and only the
first one was covered.

**How to apply:** check membership of the array BEFORE building the patch and
return 404 with a refresh-oriented message. Keep the version CAS as well — they
guard different things.
