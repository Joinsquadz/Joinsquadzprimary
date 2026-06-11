---
name: Event mutation optimistic concurrency
description: Whole-document events.* JSON writes must be version-checked; per-key disjoint merges (rsvps) must NOT be (they 409 spuriously). Know which pattern a new endpoint needs.
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

**Exception — per-key atomic merge (rsvps writes):** `POST /events/:id/rsvp` and
`POST /events/join` do NOT use the version gate. Each caller only ever sets its
OWN key in the `rsvps` map, so the write is a server-side merge of one disjoint
key — `rsvps = COALESCE(rsvps,'{}'::jsonb) || {[userId]: status}::jsonb` — not a
whole-column replace. Disjoint-key merges can't clobber each other, so gating
them on the whole-row version produced SPURIOUS 409s for concurrent RSVPs from
different users (a non-conflict reported as a conflict). Version is still bumped;
a missing row → 404 (not 409). Use this per-key merge ONLY when every caller
touches a distinct key; whole-document JSON writes (`costs`/`tasks`/`polls`/
`messages`) still need the version gate above. Verified under real concurrency by
`src/__tests__/concurrency/realDb.concurrency.test.ts` (run via `test:concurrency`).

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
