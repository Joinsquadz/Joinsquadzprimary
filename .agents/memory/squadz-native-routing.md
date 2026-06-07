---
name: squadz-native expo-router navigation
description: Why pushing a tab screen by bare path silently lands on Home, and the canonical form to use.
---

# Navigating to tab screens in squadz-native (Expo Router v6)

For imperative navigation to a screen that lives inside `app/(tabs)/`, always push the
**explicit group path** `"/(tabs)/<screen>"` — e.g. `router.push({ pathname: "/(tabs)/create" })`.

**Why:** Pushing the bare `"/create"` does NOT open `app/(tabs)/create.tsx`. In this setup
(root `Stack` in `app/_layout.tsx` with explicit `Stack.Screen` declarations, none for `create`),
a bare `/create` resolves to the `(tabs)` group's default/anchor screen, which is `index` (Home).
Symptoms users see: tapping an event-create CTA "goes to Home" (you leave the current screen and
land on Home), or the Home FAB "New Event" "does nothing" (you're already on Home, so it's a no-op).
The not-found screen is NOT involved — it never auto-redirects.

**How to apply:** Use `"/(tabs)/create"`, `"/(tabs)/events"`, `"/(tabs)/photos"`, etc. for the
hidden tab screens. Squad creation is a separate root route `"/squad/create"` (correct as-is).
If you ever see an event/photos/etc CTA mysteriously bouncing to Home, check for a bare
`"/<tab-screen>"` push and switch it to the `"/(tabs)/..."` form. Working precedents in the repo:
AI Suggestions and the availability best-time handoff already use `"/(tabs)/create"`.
