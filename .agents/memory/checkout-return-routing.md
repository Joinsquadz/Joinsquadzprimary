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

## Native iOS/Android: use WebBrowser.openBrowserAsync, not Linking.openURL

`Linking.openURL` on native opens the system Safari/browser as a SEPARATE APP.
The user pays → Stripe redirects to `success_url` (a web page) in Safari → user
must manually switch back to the app → AppState "active" fires → confirmLoop runs.
This is confusing UX and relies on the user knowing to return.

**Fix:** `WebBrowser.openBrowserAsync` (expo-web-browser, already installed) opens
a SFSafariViewController / Chrome Custom Tab INSIDE the app session. The Promise
blocks until the user taps "Done". Caller receives `{ok:true, confirmNow:true}`
and calls `confirmLoop()` immediately — no AppState listener needed for native.

**How to apply:** any native-web external URL that needs a "done" callback (OAuth,
payment, email verification) should use `openBrowserAsync` on native and check
`confirmNow` in the caller. Keep `AppState` listener only for web tab fallback.

## Web popup opening: never trust Linking.openURL

react-native-web's `Linking.openURL` wraps `window.open(url,'_blank','noopener')`
and **resolves successfully even when the popup is blocked** (window.open returns
null without throwing). Inside the sandboxed canvas preview iframe popups are
always blocked, so checkout silently did nothing.

**How to apply:** any web flow that opens an external URL (Stripe checkout,
portal, OAuth) must call `window.open` itself and check the return value:
opened → done; blocked + top-level tab → `window.location.assign(url)`;
blocked + embedded iframe → fail loudly with user-facing error (Stripe/IdPs
refuse to render inside frames, so navigating the iframe dead-ends). See
`lib/checkout.ts` `openCheckoutUrl`.
