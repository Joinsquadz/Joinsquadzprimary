---
name: Expo web preview CORS
description: Why the Expo web preview blanks with CORS errors unless the api-server allowlists the Expo dev domain
---

# Expo web preview is cross-origin to the api-server

The Expo app's web preview is served from a SEPARATE domain (`$REPLIT_EXPO_DEV_DOMAIN`,
e.g. `...expo.kirk.replit.dev`) that **bypasses the shared path proxy**. So its browser
`fetch` calls to `/api/*` cannot be relative — they must target the absolute main dev
domain (`app.config.js` sets `extra.apiBase = https://$REPLIT_DEV_DOMAIN`, and
`resolveApiBase()` returns that on web). That makes every web-preview API call
**cross-origin**.

**Rule:** the api-server CORS allowlist (`buildAllowedOrigins()` in
`artifacts/api-server/src/app.ts`) must include `https://$REPLIT_EXPO_DEV_DOMAIN`, not
just `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS`.

**Why:** if the Expo origin isn't allowlisted, the CORS preflight fails
(`No 'Access-Control-Allow-Origin'`), every data fetch errors, and the app is stuck on a
**blank white screen** in the web preview — looks like "expo is broken" but Metro/bundle
are fine.

**How to diagnose:** screenshot the app preview and read the browser console.
- CORS-blocked messages → Expo origin missing from the allowlist (this bug).
- `401` instead of CORS → requests now reach the server; that's just the logged-out state,
  not a bug. `/login` should render normally.

Native builds are unaffected (no `Origin` header → CORS passes them through). This only
bites the web preview.
