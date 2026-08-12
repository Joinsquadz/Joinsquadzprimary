---
name: stripe-replit-sync bundling + migrations
description: Stripe sync must preserve migration assets, log migration failures, and never block HTTP readiness on remote webhook provisioning.
---

# stripe-replit-sync esbuild + migrations

The api-server bundles with esbuild (CJS). `stripe-replit-sync` ships its own
migrations/SQL and must run them to create the `stripe.*` schema (29 tables incl
`stripe.accounts`). Two failure modes that look unrelated to Stripe:

- **Must externalize `"stripe-replit-sync"` in `build.mjs`'s `external` array.**
  If it gets bundled, its packaged migration assets don't resolve at runtime and
  init logs `relation "stripe.accounts" does not exist` — Stripe sync then
  half-works (some tables missing, backfill writes nothing useful).
- **Pass `logger` to `runMigrations` in `src/index.ts`.** Without it, migration
  failures are swallowed and you get the same missing-table symptom with no clue.

**Why:** the warning surfaces only at server init, long after the build looks
clean, so it's easy to chase the wrong layer (Stripe keys, webhooks, DB perms).

**How to apply:** any time Stripe sync tables look missing/empty after a build
change, first check both of these before touching Stripe config or the DB.
Restart the api-server workflow after fixing — migrations run at init only.

## Startup readiness

Remote Stripe operations such as managed-webhook provisioning must run after the
API has started listening, in a logged background task. Schema migrations may
finish before readiness, but an unbounded external API wait must not hold the
port closed.

**Why:** the publisher kills services that do not open their configured port
within its readiness window; a stalled webhook request otherwise turns a healthy
build into a failed publish.

**How to apply:** keep startup-critical local setup bounded, and log failures
from deferred Stripe network work so it can retry on the next process start
without hiding the API from health checks.
