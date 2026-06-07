---
name: squadz-native expo-router — don't navigate to hidden tabs; use root Stack routes
description: Hidden-tab navigation is unreliable on native; screens reached imperatively from anywhere should be root Stack routes.
---

# Don't navigate to hidden tab screens in squadz-native (Expo Router v6)

**Rule:** A screen you navigate to imperatively from multiple places (e.g. an event-create form)
should be a **root Stack route** (a file directly under `app/`, registered with
`<Stack.Screen name="..." />` in `app/_layout.tsx`), NOT a hidden tab inside `app/(tabs)/`.
Reach it with plain `router.push("/create")`.

**Why:** Navigating to a HIDDEN tab inside the `(tabs)` group is unreliable across platforms.
`router.push("/(tabs)/create")` silently lands on Home (the anchor tab). `router.navigate(...)`
works on **web** but still **no-ops on native** (iOS/Android) — the two diverge, so there is no
single call that reliably reaches a hidden tab on every platform. The durable fix is to stop using
a hidden tab for these screens entirely: promote them to root Stack routes. `create` was moved from
`app/(tabs)/create.tsx` → `app/create.tsx` for exactly this reason.

Symptoms when this regresses: an event-create CTA "goes to Home" (squad detail "Plan an event"),
or the Home FAB "New Event" "does nothing" on a real device while seeming fine on web.

**How to apply:**
- New screen reachable from many entry points → root Stack route + `router.push("/name")`. Object
  form with params is fine. After create-success, `router.replace("/event/:id")` so Back doesn't
  return to the stale form.
- A root Stack screen has NO tab bar; if it needs to return to a tab context, add an explicit
  chevron-back header (`router.canGoBack() ? router.back() : router.replace("/(tabs)")`) and pad the
  bottom with `insets.bottom` (no TAB_BAR_HEIGHT — that's only for screens UNDER the tab bar).
- Existing root Stack screens (`/squad/create`, `/vault`, `/availability`, `/friends`) already work
  this way — `push` is correct for them.
- `events`/`photos` remain hidden tabs (still registered in both `NativeTabLayout` via
  `<NativeTabs.Trigger name="..." hidden />` and `ClassicTabLayout`); if you ever need to navigate to
  them reliably from native, promote them to root Stack routes too rather than fighting hidden-tab nav.
- Verify auth'd flows with the testing skill (signup → onboarding → Home); AuthGuard bounces
  unauthenticated sessions to /login so plain screenshots can't reach these screens.

## Public squad share / deep-link
- A shared public-squad link must be openable by LOGGED-OUT friends: the preview API route is intentionally unauthenticated (exposes only safe metadata, never raw member ids, gated on isPublic), AND the preview screen must be allowlisted in `AuthGuard` (app/_layout.tsx) or the guard bounces unauthenticated users to /login before it renders. **Any new logged-out-reachable deep-link screen needs BOTH an unauth API path and an AuthGuard exception.**
- Post-auth deep-link targets are threaded as a param through login → (signup → onboarding) and redirected after auth, mirroring the existing invite-event pattern. Reuse that chain for new ones.
- `useSegments()` returns a typed union of known route names; comparing against a newly-added segment fails typecheck — cast `segments[n] as string` (existing convention).
- Shared link URLs should include the `https://` scheme for cross-platform tap reliability.
