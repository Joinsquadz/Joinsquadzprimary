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

## DB RTT measurements (dev container → Supabase Transaction pooler, SELECT 1 × 20)

* **Staging ca-central-1** (port 6543): avg 77.5 ms, p50 77.4 ms, p95 77.9 ms — extremely consistent.
* **Production us-east-1** (port 6543): avg 66.3 ms, p50 66.0 ms, p95 66.2 ms — slightly faster same order.
* These are from the Replit *dev container*, NOT from the production deployment servers. Inferred prod-server→DB RTT from response times is ~26–50 ms (closer, same AWS region).
* Previous analysis stated "600 ms RTT" — this was incorrect and fabricated. Actual RTT is ~70 ms.

## Pool ceiling (corrected)

* Pool ceiling = 25 / 0.077 = ~325 q/s (staging) or 25 / 0.066 = ~379 q/s (production from dev container).
* Each authenticated request hits 3 DB round-trips: rate_limiter UPSERT + session lookup + data query.
* Effective throughput ceiling: ~108–126 req/s. Artillery peak = 50 arr/s × 5 req = 250 req/s → 2× over ceiling → severe queuing on staging.
* Root cause of 8–9 s p50 on staging = pool saturation (25 slow connections) + Replit dev-sandbox compute limits, NOT 600 ms RTT.

## Measured performance — staging (dev sandbox, ca-central-1, pool_max=25)

* Baseline (5–10 concurrent): 2xx p50 ≈ 314 ms, p95 ≈ 699 ms, p99 ≈ 728 ms.
* Peak (100 concurrent): 2xx p50 ≈ 7 865 ms, p95 ≈ 9 047 ms, p99 ≈ 9 230 ms; ERR_SOCKET_TIMEOUT at peak.
* Degradation onset: ~25 concurrent.

## Measured performance — production (Replit deployment, us-east-1, pool_max=25)

* Baseline (5–10 concurrent): 2xx p50 ≈ 144 ms (aggregate), fast because prod server and DB are co-region.
* Peak (100 concurrent): all p50 ≈ 671 ms, 2xx p50 ≈ 1 326 ms, 2xx p95 ≈ 1 408 ms, p99 ≈ 1 556 ms.
* 500 error rate: ~6.7% across full test (2 834 / 42 485); concentrated at peak load.
* vusers.failed: 122 / 8 550 = 1.4% (vs. staging 498 / 500 per peak phase).
* Production is ~7× better p50 at peak than staging — due to lower prod-server→DB RTT + better compute on Replit deployment infra.

## Artillery test harness bugs found and fixed

* `config.defaults.headers` in Artillery 2.x resolves `{{ token }}` at parse time (no VU context) → empty string → 401. Fix: put `Authorization: Bearer {{ token }}` in each individual `get:` step's `headers`.
* `order: random` causes token reuse: 50 tokens × 8 550 VUs = 855 uses/token > 500/15-min limit. Fix: `order: sequence`. With 100 tokens, max 427 uses/token.
* Production URL parse: pg.Pool with `connectionString` fails on passwords containing `/` or `,` (Node.js `new URL()` choke). Fix: parse postgres URL manually by splitting on the last `@`, extract individual `{host, port, user, password, database}` fields.

## Compute tier progression (confirmed via shared_buffers + postmaster_start)

* **Nano**: shared_buffers=128MB, max_connections=97 (free tier). 6.7% 500s, 1.4% failed VUs, 5xx p99=8,868ms (slow pool timeouts).
* **Micro**: shared_buffers=256MB, max_connections=60. 3.3% 500s, 0.9% failed VUs, 5xx p99=6,440ms. CPU bottleneck eased; pool still saturating.
* **Small**: shared_buffers=512MB, max_connections=90. 3.2% 500s, **0% failed VUs**, 5xx p99=327ms, 5xx max=431ms. Pool saturation eliminated; 500s are now fast application errors.

## DB_POOL_MAX sizing (Small, max_connections=90)

Chosen value: **45**.
Reasoning: 90 − 3 superuser − 10 Supabase internals − 7 direct/migration headroom = 70 available. 45 uses 64%, leaving 25 for headroom and a second instance.
Applied: shared env var `DB_POOL_MAX=45` + connection.ts hardcoded default updated from 25 → 45.
**Needs production redeploy to take effect on the running deployment.** Env var change alone does not restart the live container.

## Key finding: "fast 500s ≠ pool saturation"

After Small upgrade, 5xx max dropped from 9,525ms (Micro) to 431ms (Small). Pool connection timeout is 5,000ms — if pool overflow was the cause, 500s would take ≥5s. Fast 500s (207ms median) mean the remaining 3.2% errors are application-level (unhandled exceptions, query errors on test accounts, Transaction pooler statement limits), NOT pool queue overflow. Investigate these separately.

## Peak-phase selection bias

Micro peak 2xx p50 appeared better (773ms) than Small (1,300ms). This is selection bias: Micro had 75 failed VUs (socket timeouts — slow sessions never measured in 2xx); Small measured ALL sessions including previously-slow ones. Small actually handled more work successfully.

## Remaining open question: /api/notifications/preferences 404

All three test runs show ~20% of requests (1 in 5 scenario steps) returning 404 for /api/notifications/preferences. This route either doesn't exist or has a different path. Worth investigating as a potential real missing endpoint, not just a test artifact.

## Staging server WorkflowsRestart issue

* WorkflowsRestart for `artifacts/api-server: API Server` does NOT kill manual staging servers started from a different shell. The misdiagnosis was that kill -9 cleanup commands were accidentally killing the production server (both running `dist/index.mjs`).
* Safe cleanup: only kill by exact PID, never `grep dist/index.mjs | kill`.

## Env var skip flags added to production code

* `SKIP_SCHEMA_SYNC=1` → skips schemaSync in `lib/schemaSync.ts:ensureSchema()`. Safe for staging when all tables already exist.
* `SKIP_STRIPE_INIT=1` → skips Stripe schema + webhook setup in `index.ts:initStripe()`. Safe for staging/CI.
* Neither flag has any effect in production (never set there).
