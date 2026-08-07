---
name: Staging load-test setup
description: How to run and reproduce the Artillery load test against a staging Supabase instance; key env vars, pitfalls, and measured performance.
---

## Setup

* Schema: `drizzle-kit push` from `lib/db/` with `SUPABASE_DB_URL=<staging-url>` — one command, idempotent.
* schemaSync extra tables (rate_limits, squad_mutes, etc.) are present AFTER server start. Use `SKIP_SCHEMA_SYNC=1` to skip if they're already there — avoids hanging on Transaction pooler DDL.
* Stripe init makes external HTTP calls on startup; use `SKIP_STRIPE_INIT=1` to skip for staging.
* Server must be started in the SAME shell that runs Artillery; `nohup &` children are killed when the shell exits in Replit's ShellExec environment.
* pg resolution for seed/cleanup scripts: use `createRequire(new URL('../lib/db/package.json', import.meta.url))` — pg is a direct dep of lib/db, not of load-tests/.

## Session seeding

* Seed script: `node load-tests/seed-direct.mjs --count=50` with `STAGING_DB_URL=<staging Transaction pooler URL>`.
* Sessions go into the public `sessions` table (sid/sess/expire). The `sess` column is jsonb; pass the JS object directly (or stringified JSON — pg casts text→jsonb silently).
* `getSessionId()` reads the Authorization Bearer header first, then falls back to the cookie. 64-char hex SIDs work as Bearer tokens for the non-Supabase auth path.

## Rate limiter behaviour (critical)

* `DEFAULT_WINDOW_MS = 15 minutes`, `API_RATE_LIMIT_MAX = 500` (env `API_RATE_LIMIT_MAX`).
* Keyed `api:u:<userId>` when authenticated, `api:ip:<rawIp>` otherwise (authMiddleware runs before the limiter in app.ts so user IS set for authenticated requests).
* With `order: random` in the Artillery YAML and 50 tokens for 8 550 VU instances, each token gets ~855 uses → hits 500/15-min limit at ~2.6 min. Use `order: sequence` to distribute evenly.
* IP bucket (`api:ip:127.0.0.1`) accumulates across test runs; previous test's 401-heavy run (unauthenticated → IP key) can pre-fill the bucket. Wait for 15-minute window to fully expire between tests in the same Replit shell.

## Measured performance (staging Transaction pooler, ca-central-1, pool_max=25)

* **Baseline (5–10 concurrent, no rate-limit pressure)**: p50 ≈ 170–250 ms, p95 ≈ 370–430 ms, p99 ≈ 850 ms.
* **Sustained 50 concurrent**: p50 ≈ 1 000–3 000 ms — already degrading (pool starts queuing).
* **Peak 100 concurrent**: p50 ≈ 8 025 ms, p95 ≈ 9 230 ms, p99 ≈ 9 417 ms — severe degradation.
* **5xx onset**: appears at ~25–50 concurrent sessions (DB pool saturation, pool_max=25 with 600 ms RTT ≈ 42 q/s ceiling).
* **Degradation onset**: visibly at ~25 concurrent sessions; unacceptable at 50+.

## Why the Transaction pooler is the bottleneck

* Staging DB is in Supabase ca-central-1; RTT from Replit host ≈ 600 ms.
* Pool ceiling = pool_max / avg_query_time = 25 / 0.6 = ~42 q/s.
* Each authenticated request = 2 DB round-trips (session lookup + data query) → 21 concurrent sessions saturate the pool.
* Production deployment with Session pooler / direct connection would have lower RTT and higher throughput.

## Staging server WorkflowsRestart issue

* WorkflowsRestart for `artifacts/api-server: API Server` does NOT kill manual staging servers started from a different shell. The misdiagnosis was that kill -9 cleanup commands were accidentally killing the production server (both running `dist/index.mjs`).
* Safe cleanup: only kill by exact PID, never `grep dist/index.mjs | kill`.

## Env var skip flags added to production code

* `SKIP_SCHEMA_SYNC=1` → skips schemaSync in `lib/schemaSync.ts:ensureSchema()`. Safe for staging when all tables already exist.
* `SKIP_STRIPE_INIT=1` → skips Stripe schema + webhook setup in `index.ts:initStripe()`. Safe for staging/CI.
* Neither flag has any effect in production (never set there).
