---
name: Stripe checkout return routing
description: How to land users back on a specific screen and refetch after returning from Stripe checkout in Squadz web + mobile
---

# Stripe checkout return routing

The server's checkout `success_url` is **fixed** to `/home?checkout=success`
(artifacts/api-server/src/routes/stripe.ts) and is not parameterized per call.

**Web:** to route the user back to a specific tab after the Stripe redirect,
store intent in `sessionStorage` (e.g. `squadz:checkoutReturnTab`) *before*
`window.location.href = url`. Home() reads + clears it in the `checkout=success`
effect and sets the tab. The Stripe round-trip is a full page reload, so each tab
component refetches on mount — that alone unlocks gated content; no manual reload.

**Mobile:** `Linking.openURL` opens the system browser; returning to the app does
NOT reload or refire screen focus reliably. Use an `AppState` "active" listener to
refetch (subscription + photos) so newly-unlocked content appears.

**Why:** users intending to upgrade from the vault were dumped on the profile tab
and had to navigate back; the fix converts intent in place and unlocks photos
without a manual refresh.
