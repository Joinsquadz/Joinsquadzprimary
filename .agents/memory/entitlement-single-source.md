---
name: Entitlement must come from the shared resolver
description: Why any local re-implementation of the Squadz+ check silently locks out every paying subscriber, and how to spot it.
---

# Squadz+ entitlement has exactly one resolver

Every Pro gate must resolve entitlement through the shared `resolveProStatus`
helper in the api-server lib layer. A route file must never define its own copy.

**Why:** Squadz+ is sold as a native IAP. RevenueCat's webhook is the sole
server-state flip and it writes the `is_squadz_plus` flag on the user — a paying
subscriber has **no Stripe customer and no Stripe subscription row at all**. The
shared resolver checks that flag first and treats Stripe as a dormant legacy
fallback. A local copy written against Stripe only (the older purchase surface)
therefore answers "free" for *every real subscriber*, which is the common path,
not an edge case.

The failure is silent and looks like data loss rather than a permissions bug:
the personal vault roll-up is designed to answer `{photos: [], requiresPro: true}`
for free users, so a subscriber sees an **empty vault** and their saves/favorites
403 with an upgrade prompt they already paid for. Nothing errors, nothing logs.

**How to apply:** When adding or reviewing a Pro gate, grep the api-server routes
for a locally declared `resolveProStatus` / `isPro` / subscription lookup. If a
route resolves entitlement without importing the shared helper, that is the bug.
Test coverage must include the IAP shape (flag true, both Stripe fields null) and
not just a Stripe subscriber — a suite that only builds Stripe-shaped fixtures
passes completely while the real subscriber is locked out.

## Related trap: stale published build reads as a code bug

An endpoint that 400s in production while the same request is handled correctly
by current source and a green test suite usually means the **published build
predates the change**, not that the code is wrong. Autoscale restarting (fresh
uptime, healthy pool) does NOT mean a rebuild — it re-runs the existing image.
Confirm by finding the commit that added the query shape and comparing it to when
the deployment was last published; the request logs strip query strings, so
identify the scope by which client screen was open, not from the URL.
