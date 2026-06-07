---
name: Expo native modules in squadz-native
description: How to add/pin expo native modules in this Expo app and keep the web build alive
---

# Expo native modules (squadz-native)

## Pin to the SDK-aligned version, not "latest"
Some expo native modules in `artifacts/squadz-native/package.json` were pinned to
wrong major versions for the installed SDK (e.g. `expo-calendar ^56` while the app
is Expo SDK 54). Those mismatches don't fail typecheck but crash on native when the
module loads.

**Rule:** before installing/pinning an expo-* native module, read the SDK's expected
version from `artifacts/squadz-native/node_modules/expo/bundledNativeModules.json`
(grep the package name) and pin to that. Do NOT run `npx expo install` (the expo
skill discourages running `npx expo` directly) — edit package.json + `pnpm install`.
After installing, restart the `artifacts/squadz-native: expo` workflow and confirm
the package drops off Metro's "should be updated for best compatibility" warning.

**Why:** wrong-version native modules pass typecheck + web bundle but crash in Expo
Go / on device, where they can't be caught from this environment.

## Keep no-web-support modules out of the web bundle
`expo-calendar` (no web support) and `expo-notifications` (partial) must not be
statically imported, or React Native Web crashes on load. Pattern used: dynamic
`await import("expo-calendar")` **behind** a `Platform.OS === "web"` early-return
that provides a web fallback (e.g. open a Google Calendar template URL; return a
graceful "available in the mobile app" result for reminders). Verify by checking the
expo workflow logs show `Web Bundled` with no error after the change.
