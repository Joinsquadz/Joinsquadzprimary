---
name: Stripe sync backfill (stripe-replit-sync)
description: Why stripe.products can be empty even though the Stripe account has products and the server logs "Stripe data synced".
---
`stripeSync.syncBackfill()` from `stripe-replit-sync` must be called with an
explicit object selector, e.g. `syncBackfill({ object: "all" })`.

**Why:** Internally it does `const { object } = params ?? { object: this.getSupportedEventTypes }`.
Called with no args, `object` becomes a *function reference* (not the string
"all"), so its switch matches no case, hits `default: break`, and syncs nothing —
yet still resolves successfully, so the caller logs "Stripe data synced" while
`stripe.products`/`stripe.prices` stay empty. That makes mobile/web checkout fail
with "Pro plan not found" (the helper looks up the "Squadz Pro" yearly price).

**How to apply:** On the api-server startup path (src/index.ts initStripe), keep
the `{ object: "all" }` arg. Webhooks only cover entities created *after* the
webhook exists; pre-existing products need this backfill.

Separately: if the `stripe` schema ever exists but has zero tables (no
`_migrations`), runMigrations may report success while creating nothing —
re-running `runMigrations({ databaseUrl })` once rebuilds all stripe.* tables.
