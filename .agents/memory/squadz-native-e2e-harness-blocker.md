---
name: squadz-native E2E harness auth (RESOLVED)
description: How authenticated squadz-native web flows became testable in Playwright/runTest, and the same-origin invariant that keeps them testable.
---

# squadz-native authenticated web flows ARE testable via Playwright/runTest

**Status: RESOLVED.** `runTest` can now log in as a seeded user and load real
authenticated data in squadz-native web screens.

**Original blocker:** on web, `API_BASE` resolved to the ABSOLUTE main dev domain
(`extra.apiBase` = `https://$REPLIT_DEV_DOMAIN`), so the browser made
cross-origin calls the headless Playwright browser could NOT reach (it can't hit
`*.replit.dev` even though in-container `curl` to the same URL works). Login
appeared to succeed (guard flipped, tabs rendered) but every authenticated GET
401'd and the api-server logged ZERO `/api/*` hits.

**Fix (same-origin on web):**
- `lib/api.ts` `resolveApiBase()` returns `""` on web (relative `/api/...`),
  BEFORE consulting `extra.apiBase`. Native still uses the absolute base.
- `metro.config.js` adds a dev-only `server.enhanceMiddleware` reverse proxy that
  forwards `/api/*` from the Expo web dev server to the shared proxy
  (`http://localhost:80`, which routes `/api` to the api-server). Proxying happens
  server-side in the container, so `localhost:80` is always reachable.
- Net: relative same-origin `/api` works for BOTH the normal preview browser and
  the headless test browser; no CORS cross-origin hop needed on web.

**Invariant to keep it working:** on web the app and its `/api` calls MUST share
one origin. Don't reintroduce an absolute web API base, and don't remove the
Metro `/api` proxy — either one re-breaks authenticated UI tests. Native/prod are
untouched (native = absolute base; prod `/api` handled by the shared proxy).

**Runbook:** see replit.md "Automated UI tests (authenticated mobile-app
screens)" — start the api-server + expo workflows, seed a user via
`POST /api/auth/register`, then drive the onboarding Log-in flow in `runTest`.

**Two runTest gotchas (multi-artifact era):**
- Navigate to the **Expo dev domain** (`https://$REPLIT_EXPO_DEV_DOMAIN/`), NOT
  the shared-proxy `/mobile/...` path. Under `/mobile/` the HTML loads but the JS
  bundle `<script src>` points at the Expo domain (cross-origin/unreachable to the
  headless browser) → blank white page. And the Metro `/api` same-origin proxy
  only intercepts when the browser IS on the Expo origin. Enter at the Expo root
  `/` and let the logged-out AuthGuard redirect to `/login`; deep-linking straight
  to a sub-route (`/login`, `/vault`) on a cold load also renders blank.
- After login, reach screens by **tapping through the app UI** (SPA `router.push`),
  not by typing a new absolute URL. A hard URL navigation reloads the app; the
  screen's first authed fetch can fire before the AsyncStorage/localStorage token
  restore completes → transient 401 → e.g. squad vault shows "0 items / No photos
  rolled up yet". SPA nav keeps `authToken` in memory so fetches are authed.
