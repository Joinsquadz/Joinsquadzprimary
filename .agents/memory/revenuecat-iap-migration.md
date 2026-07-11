---
name: RevenueCat IAP migration (Squadz+)
description: How Squadz+ subscriptions work after migrating from Stripe web checkout to native IAP via RevenueCat.
---

Squadz+ is sold via **native IAP only** (App Store / Play) through RevenueCat. The
Stripe web-checkout path was retired on the client (`lib/checkout.ts` deleted) but
the Stripe **webhook + founding ledger stay dormant on the server** — do not delete
them.

**RevenueCat webhook is the ONLY thing that flips server entitlement state.** It
writes the unified `users.is_squadz_plus` flag and consumes founding spots. There
is deliberately NO competing client→server "sync entitlement" endpoint — the client
uses RevenueCat `customerInfo.entitlements.active.squadz_plus` for immediate
purchase UX, and the server catches up when the webhook lands (client polls
`/api/subscription` a few times to bust the Pro-ring cache).

**Why:** requirement was that webhooks are the single mechanism, so server state
can't diverge from RevenueCat.

**Invariants that keep biting if forgotten:**
- Identifiers MUST match in three places (client `squadz-native/lib/revenuecat.ts`,
  server `api-server/lib/revenuecat.ts`, RC dashboard): entitlement `squadz_plus`,
  products `squadz_plus_founding_yearly` / `squadz_plus_standard_yearly`.
- Founding ledger key is `rc:<original_transaction_id>` — the `rc:` prefix prevents
  collision with Stripe subscription ids in the same shared ledger table.
- Founding redemption is payment-only: `shouldRedeemFounding` excludes
  `period_type != NORMAL` (trials/intro/promo) and only fires on
  INITIAL_PURCHASE / RENEWAL / NON_RENEWING_PURCHASE. Renewals re-call with the
  same key → harmless idempotent no-op (spot consumed once).
- Webhook rethrows on redemption failure → 500 → RevenueCat retries (at-least-once);
  idempotency makes the retry safe.
- CANCELLATION / BILLING_ISSUE do NOT revoke (access continues to EXPIRATION).

**Client web-safety:** `react-native-purchases` is lazy `await import`-ed behind a
`Platform.OS==="web"` guard so web preview never crashes; web is a no-op purchase
surface ("use the mobile app"). `configureRevenueCat` stores its in-flight promise
so purchase/restore/price calls `await ensureConfigured()` first (avoids a
startup-race first-tap failure). No Expo config plugin for react-native-purchases —
autolinking handles it; do NOT add it to app.json.

**Setup state (done in-project):** the RevenueCat connector is bound (was
`not_added`, which is why the connect flow "never redirected back"). The RC project
was seeded from scratch (App Store + Play Store apps for `com.squadz.app`, the two
yearly products, the `squadz_plus` entitlement, and a current `default` offering
with founding + `$rc_annual` packages). Reproduce/extend via
`pnpm --filter @workspace/scripts run seed-revenuecat` (idempotent;
`scripts/src/seedRevenueCat.ts`, auth via the Replit RevenueCat connector — no API
key). Public SDK keys are set as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
`_ANDROID_KEY`; `REVENUECAT_WEBHOOK_AUTH` is a self-generated shared secret that
must match the RC webhook's `authorization_header` exactly (raw compare, no Bearer).

**RC admin API access:** use `@replit/connectors-sdk`
`new ReplitConnectors().proxy("revenuecat", "/v2/...")` → returns a raw `Response`
(call `.json()`); there is NO plain API key to handle.

**Webhook caveat:** the webhook points at the **dev domain** (ephemeral) for
sandbox testing — swap `url` to the production domain (`.../api/revenuecat/webhook`)
at deploy time (single field via API/dashboard); the auth header already matches.

**Android identifier-match caveat (latent):** the client finds the founding package
via `p.product.identifier === "squadz_plus_founding_yearly"` (exact). On Google Play
`StoreProduct.identifier` is usually `subscriptionId:basePlanId`
(`squadz_plus_founding_yearly:founding-yearly`), so the exact match can miss the
founding package on Android once real Play products exist. Verify against real Play
products before Android launch (a tolerant `.split(":")[0]` / `startsWith` match
fixes it) — left as-is for now since no real store products exist yet.

**Still gated on user (external, can't automate):** create the real in-app-purchase
products in App Store Connect + Google Play Console (paid dev accounts) so live
purchases can occur, and attach store credentials in RC.
