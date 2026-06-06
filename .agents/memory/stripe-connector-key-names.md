---
name: Stripe connector credential key names
description: Replit's Stripe connector uses different setting keys than the canonical stripe-replit-sync template expects.
---

Replit's Stripe connector (`connector:ccfg_stripe_*`) exposes credentials under these keys:
- `secret` — the Stripe secret key (e.g. `sk_test_...` or `sk_live_...`)
- `publishable` — the Stripe publishable key
- `account_id` — the Stripe account ID

**NOT** `secret_key` or `webhook_secret` as shown in the stripe-replit-sync code template.

**Why:** The canonical `stripeClient.ts` template from `.local/skills/stripe/references/code-templates.md` reads `settings.secret_key`, but the actual Replit connector API returns `settings.secret`. This causes a silent "missing secret key" error at startup.

**How to apply:** In any `stripeClient.ts` (api-server or scripts), always read `settings.secret` not `settings.secret_key`:
```ts
return {
  secretKey: settings.secret,
  webhookSecret: settings.webhook_secret, // this one may still be undefined — that's ok
};
```

Also: `runMigrations()` from `stripe-replit-sync` ignores any `schema` parameter — it always uses `"stripe"`. The `schema` field is not in `MigrationConfig`. Pass only `{ databaseUrl }`.

First-boot note: if the stripe schema tables don't exist yet, `runMigrations()` must succeed before `getStripeSync()` is called. On very first boot the server may fail at `findOrCreateManagedWebhook` — a second restart after migrations have run resolves it.
