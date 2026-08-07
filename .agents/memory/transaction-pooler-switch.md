---
name: Transaction pooler switch
description: How the Supabase pooler mode is controlled and what the safety audit found.
---

## Rule
`DB_POOLER_PORT=6543` overrides the port parsed from `SUPABASE_DB_URL` in `lib/db/src/connection.ts`. This switches from Session pooler (5432, ~15 concurrent clients total) to Transaction pooler (6543, 100+ concurrent clients). `DB_POOL_MAX=25` is appropriate for Transaction pooler; the old default of 9 was required by the Session pooler cap.

**Why:** Session pooler hit `EMAXCONNSESSION` under 20 concurrent users (prod + dev + scripts share 15 slots). Transaction pooler lifts that cap without any application code changes.

**How to apply:** Both env vars are set in the shared environment. The `SUPABASE_DB_URL` secret does not need to change — `connection.ts` applies the port override after parsing. If the pooler needs to revert to Session mode, set `DB_POOLER_PORT=5432` (or delete the env var).

## Safety audit results (checked before switching)
All `pg_advisory_lock` usages in the codebase use `pg_advisory_xact_lock` (transaction-scoped, auto-released at COMMIT):
- `lib/squadLimit.ts` — per-user join limit lock
- `lib/founding.ts` — founding-spot ledger lock
- `routes/events.ts` — host-rate event creation lock

No `SET` commands expected to persist across round-trips, no `LISTEN/NOTIFY`, no temporary tables. Transaction pooler is safe.

## authWriteLimiter note
The `authWriteLimiter` in `app.ts` (protects `/api/auth/*` writes, 40 req/15 min) remains in-memory `express-rate-limit`. It is intentionally not migrated — the per-endpoint DB-backed `rateLimited()` function in auth routes already provides durable limiting for the most sensitive operations (login, register, forgot, reset). The authWriteLimiter is a secondary, broad-rate-limit layer that is acceptable as in-memory.
