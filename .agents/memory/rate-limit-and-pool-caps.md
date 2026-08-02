---
name: Per-user rate limiting & Supabase pool budget
description: Why the API rate limiter keys on user id, and why DB pool max must stay small (Supabase Session pooler cap shared across processes).
---

Two shared-resource caps that keep biting:

## API rate limiter must key per-user, not per-IP
The global api-server rate limiter (express-rate-limit) keys on authenticated `req.user.id` (`u:<id>`), falling back to `ipKeyGenerator(req.ip)` for anonymous traffic. authMiddleware runs before the limiter so `req.user` is available.
**Why:** IP-keyed limiting throttles whole friend groups behind one NAT (and multi-context E2E testers) — showed up as 429 floods / infinite spinners for users who did nothing wrong.
**How to apply:** any new limiter must key per-user for authed routes; keep anonymous fallback via `ipKeyGenerator` (required for IPv6 correctness).

## Supabase Session pooler caps total clients (~15) ACROSS processes
`lib/db` pool `max` defaults are deliberately small (prod 9, non-prod 4, `DB_POOL_MAX` overrides). Dev server + prod deployment + scripts all share the same Supabase pooler budget.
**Why:** a 20-per-process default exhausted the pooler → `EMAXCONNSESSION` errors in production logs.
**How to apply:** never raise pool `max` per process without summing every process that connects; keep aggregate under the pooler's pool_size.
