---
name: Router back fallback
description: expo-router back() no-ops without history; every custom back button needs a canGoBack fallback.
---

**Rule:** `router.back()` silently no-ops ("GO_BACK was not handled") when the screen was direct-loaded or reloaded (web deep link, cold start), trapping users. Every custom back affordance must use `if (router.canGoBack()) router.back(); else router.replace(<sensible fallback>)`.

**Why:** Found during pre-App-Store E2E — reloading any pushed screen on web left dead back buttons. Applied app-wide (Aug 2026) to vault, conversation, friends, moment compose, onboarding, signup, settings screens, user profile; pattern originally from `app/activity.tsx`.

**How to apply:** New screens with a custom back button copy the inline pattern with a fallback route that matches where the screen is normally reached from (e.g. tabs root, `/(tabs)/messages`, `/profile`, `/login`).
