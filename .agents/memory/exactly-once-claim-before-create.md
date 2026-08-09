---
name: Exactly-once conversions — claim before create
description: Why a "mark it converted" stamp after creation can never be exactly-once, and why debounce must be an upsert rather than read-then-insert.
---

# Claim before create, not after

When a source object turns into a new one (an availability poll becoming an event/trip), claim the
source **inside the transaction that inserts the new object**, conditionally
(`SET converted_x = $new WHERE id = $src AND converted_x IS NULL`). A failed claim must abort that
transaction so the losing object never exists, and the caller is handed the winner rather than an
error.

**Why:** creating first and stamping "converted" afterwards can only choose which of the duplicates
to remember — the duplicate already exists. Rollback also matters for side ledgers: a free-tier
creation quota must not be charged for an object that didn't survive.

**How to apply:** pass the source id into the create endpoint instead of making a second call after
it. Validate ownership before the transaction and silently ignore an unknown/foreign source — the
new object is still valid, it just isn't credited as a conversion. A standalone convert endpoint is
still needed when the target already exists; make it idempotent for the same target and 409 for a
different one.

# Debounce with an upsert, not read-then-insert

"Was one sent recently?" followed by an INSERT is racy, and is outright broken when the debounce key
has a UNIQUE constraint: once the first row exists, every later attempt — even long after the window
expired — hits the constraint and 500s.

Use one statement: `INSERT … ON CONFLICT (key) DO UPDATE SET sent_at = now()` with a set-condition of
`sent_at < now() - window`. An empty `RETURNING` means the guard rejected it, i.e. still throttled
(429). Concurrent taps then collapse to exactly one send, never a duplicate and never a
unique-violation 500.
