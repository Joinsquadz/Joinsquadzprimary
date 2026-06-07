---
name: squadz-native expo-router navigation to hidden tabs
description: Why router.push to a hidden tab silently lands on Home, and to use router.navigate instead.
---

# Navigating to hidden tab screens in squadz-native (Expo Router v6)

`create`, `events`, `photos` live in `app/(tabs)/` as **hidden tabs** (`tabBarButton: () => null`
in `app/(tabs)/_layout.tsx`). To navigate to them imperatively, use **`router.navigate(...)`**, NOT
`router.push(...)`.

**Why:** `router.push` to a route inside the `(tabs)` navigator does NOT switch to a hidden tab —
it silently stays on / falls back to the anchor tab `index` (Home). `router.navigate` switches the
existing tab navigator to the target tab and renders it correctly. The path FORM is irrelevant:
`"/create"` and `"/(tabs)/create"` resolve identically — changing only the path string is a no-op
(verified by e2e: the bug persisted after a push-with-group-path "fix"). The differentiator is
push vs navigate. Visible tabs happen to tolerate push; hidden tabs do not.

Symptoms when this regresses: an event-create CTA "goes to Home" (e.g. squad detail "Plan an event"),
or the Home FAB "New Event" "does nothing" (you're already on Home so the no-op is invisible), or
"See all" on Upcoming events bounces to Home.

**How to apply:** For any nav targeting `/(tabs)/create`, `/(tabs)/events`, `/(tabs)/photos`, use
`router.navigate(...)` (object form with params is fine). `router.push`/`router.replace` are the bug.
Root Stack screens (`/squad/create`, `/vault`, `/availability`, `/friends`) are unaffected — push is
fine for those. Verify auth'd flows with the testing skill (signup → onboarding → Home); the
AuthGuard redirects unauthenticated sessions to /login so plain screenshots can't reach these screens.

**Latent (not yet fixed):** `app/(tabs)/_layout.tsx` `NativeTabLayout` (iOS 26+ liquid glass) never
registers create/events/photos triggers at all, so on that path they may be unreachable regardless.
Web/Android/older-iOS use `ClassicTabLayout` which does register them.
