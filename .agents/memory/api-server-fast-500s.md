---
name: API server fast-500 root cause
description: Why GET /squads and GET /events returned fast 500s under load, and what was fixed.
---

## Root cause

**Connection terminated unexpectedly → pool timeout → unhandled Express error → 500**

1. Supabase Transaction pooler closes idle TCP connections on its own schedule.
2. pg-pool doesn't detect the dead socket until a query tries to use it → `Connection terminated unexpectedly`.
3. pg-pool then tries to open a replacement connection. Under load (pool saturated), this waits up to `connectionTimeoutMillis` (5 s) and then throws `Connection terminated due to connection timeout`.
4. `GET /squads` and `GET /events` had **no try/catch** around their DB calls → the error bubbled as an unhandled Express error → 500.
5. `GET /feed` and `GET /activity` already had try/catch → those returned a structured 500, not an unhandled crash.
6. `authMiddleware` also had no try/catch around `getSession(sid)`, `getUserFromAccessToken`, `clearSession`, `refreshIfExpired`, and the Supabase JWT path (`supabaseAdmin.auth.getUser` + `isTokenRevoked`).

## How it was confirmed

- Track B single-user test (5 accounts × 4 endpoints × 4 rounds = 80 requests): **all 200** → error only manifests under pool pressure.
- Deployment logs showed the exact error chain: `Connection terminated unexpectedly` (inner) → `Connection terminated due to connection timeout` (outer) in a background scan hitting the same pool.

## Fixes applied

1. **squads.ts** `GET /squads`: wrapped `Promise.all([db.select…, storage.getMutedSquadIdsForUser])` in try/catch → `500 { error: "Failed to load squads" }`.
2. **events.ts** `GET /events`: wrapped `storage.getSquadIdsForUser` + `db.select` in try/catch → `500 { error: "Failed to load events" }`.
3. **authMiddleware.ts**: wrapped the Supabase JWT path (`supabaseAdmin.auth.getUser` + `isTokenRevoked`) in try/catch; wrapped the session path (`getSession` → `getUserFromAccessToken` / `clearSession` → `refreshIfExpired` → `clearSession`) in try/catch. Both degrade to "unauthenticated" on transient DB failure rather than crashing the request.

**Why:** The pattern "async Express handler with no top-level try/catch" is silently dangerous — any DB hiccup under load produces an unhandled Express error → 500 with no structured response or log context. All route handlers should have a catch block.

**How to apply:** When adding new async route handlers, always wrap the body in try/catch. Scan existing handlers periodically for the same gap (especially simple CRUD list endpoints added quickly).

## DB pool sizing (concurrent with this fix)

`DB_POOL_MAX` default raised from 25 → 45 in `lib/db/src/connection.ts` (and `DB_POOL_MAX=45` set as env var). Small-tier math: `max_connections=90 − 3 superuser − ~10 Supabase internals − ~7 headroom = ~70 available; 45 = 64%`.

A startup log line was added to index.ts: `[db-pool] effective pool max` with `{ DB_POOL_MAX, source }` so post-deploy verification doesn't require guessing.
