---
name: Event mutation optimistic concurrency
description: Every write to an events.* JSON column must be version-checked; new endpoints keep forgetting this.
---

Every endpoint that mutates an `events` JSON column (`costs`, `rsvps`, `tasks`,
`polls`, `messages`) reads the row, mutates the JSON in memory, then writes it
back wholesale. Because the write replaces the whole column, two concurrent
writers from stale snapshots silently clobber each other.

**Rule:** every such write MUST use the optimistic-concurrency pattern already
used by RSVP/tasks/add-cost/polls in `artifacts/api-server/src/routes/events.ts`:
- accept an optional `version` in the Zod body (`z.number().int().optional()`),
- `WHERE id AND version` when a client version is supplied (fall back to `WHERE id` only when absent),
- `version: sql\`${eventsTable.version} + 1\`` in the same `.set(...)`,
- if `.returning()` yields no row → `res.status(409).json({ conflict: true, ... })`.

The client (`squadz-native/context/AppContext.tsx`) mirrors this: every event
mutation does `const currentVersion = events.find(e => e.id === eventId)?.version`
and adds it to the body when defined.

**Why:** the cost-split *settlement* endpoints (`mark-paid`, `shares/:uid/confirm`)
shipped doing a plain `WHERE id` write with no version bump — a lost-update hole
where settling from a stale snapshot could overwrite newer cost JSON. A code-review
gate caught it. Pattern was already established everywhere else; the new endpoints
just skipped it.

**How to apply:** when adding ANY new event-mutation route, copy the version
guard from a neighboring handler in the same file. Don't write `events.*` with a
bare `WHERE id`.
