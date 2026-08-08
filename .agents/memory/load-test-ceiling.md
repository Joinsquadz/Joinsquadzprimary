---
name: Load-test ceiling & Artillery pooling
description: Real production concurrency ceiling found Aug 2026 and how to load-test from one Replit container without port exhaustion
---

# Load-test ceiling & Artillery pooling

**Rule:** Single-container Artillery runs above ~600 arrivals/s MUST set `http.pool` (keep-alive connection pool) instead of `maxSockets`; per-request sockets exhaust the container's ~28k ephemeral ports (EADDRNOTAVAIL) and fail the TEST, not the server. sysctl port-range expansion is permission-denied in the container.

**Why:** The 1200-concurrent run failed with 19k EADDRNOTAVAIL; rerunning 900 with `pool: 1500` produced zero port errors and exposed genuine server degradation.

**Measured ceiling (Aug 2026, hot-read path, prod):**
- 300 concurrent: clean, 2xx p50 165ms / p95 632ms
- 600: bends — p50 347ms / p95 1023ms, zero errors
- 900: real degradation — p50 369ms / p95 1.9s / p99 7.7s, ~3% requests hit the 10s client timeout
- Ceiling ≈ 600–800 sustained before user-facing failures; fine for 10k accounts (150–250 needed), marginal for 100k (500–1000 needed).

**How to apply:** step configs live in `load-tests/squadz-*.yml` (900 has pooling); always seed with `seed-prod.mjs` and run `cleanup-prod.mjs` after. 429s at scale are token-reuse artifacts (100 tokens vs 500 req/15min limit) — judge only 2xx latency.
