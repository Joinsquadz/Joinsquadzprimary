---
name: Plan (event/trip) chat lives in conversation threads
description: Event/trip chat moved off the events JSON column onto conversations.event_id; the visibility rule is shared, not duplicated, and the unique index is load-bearing.
---

## The rule

Event and trip chat is a real conversation thread (`conversations.event_id`, one thread per plan), NOT an array on the event row. Plan chat sends must never touch the parent event, and must never carry an event `version`.

**Plan visibility is one shared rule, injected — not a storage method the routers call.**
The rule (host / explicit personal invite / CURRENT squad membership; plain events additionally accept an existing RSVP key; trips deliberately ignore rsvps) lives in a standalone module that takes a "read this squad's current members" function as an argument. The events router and the storage layer each pass their own reader.

## Why

Two separate reasons, both learned the hard way:

1. **Drift.** Chat access has to evaluate *exactly* the same visibility as the plan itself, or a removed squadmate keeps reading the thread after losing the plan. A second copy of the rule in the router is guaranteed to drift.
2. **The route tests mock `../storage` wholesale.** Putting the shared rule on the storage object and calling it from a route handler made ~17 event route test files fail at once with blanket 500s (the mock has no such method → throw → error handler). Nothing in the failure output points at the mock; it just looks like every event endpoint broke. A standalone pure module with an injected reader keeps handlers depending only on `storage.getSquad`, which those mocks already provide.

**`ON CONFLICT` needs the index to exist in the REAL database.** A `uniqueIndex()` declaration in the Drizzle schema does nothing at runtime — it must also be created in `schemaSync.ts` (see [Schema sync gap](schema-sync-gap.md)). Here the unique index on `event_id` is not merely a guard: both get-or-create and the legacy backfill rely on `ON CONFLICT ("event_id") DO NOTHING` to converge concurrent opens on one thread. Without it, every insert dies with "no unique or exclusion constraint matching the ON CONFLICT specification" — and because the backfill runs at startup, the server boots "fine" while silently having migrated nothing. Check startup logs for the backfill line, don't assume.

## How to apply

- Any new surface that reads or writes plan chat: call the shared visibility rule; never re-derive "can they see this plan" inline.
- Backfilling embedded JSON into rows: use deterministic ids derived from the source, drain the JSON column in the same transaction, don't bump the parent's `version`, and stamp migrated participants as caught up (`GREATEST(now(), newest message timestamp)`) or old history lands as unread for everyone.
- The legacy `events.messages` column is intentionally left in place post-migration; it is drained, not dropped.
