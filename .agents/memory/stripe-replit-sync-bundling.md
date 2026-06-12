---
name: stripe-replit-sync bundling + migrations
description: Why the api-server must externalize stripe-replit-sync and pass a logger to runMigrations, or Stripe sync silently half-works.
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
