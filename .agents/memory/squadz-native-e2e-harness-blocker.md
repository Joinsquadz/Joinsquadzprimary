---
name: squadz-native E2E harness auth blocker
description: Why Playwright/runTest can't exercise authenticated squadz-native web flows, and the reliable fallback.
---

# squadz-native authenticated flows can't be verified via Playwright/runTest

The Playwright browser used by `runTest` cannot exercise any **authenticated**
squadz-native web flow (vault, squads, events, subscription, etc.).

**Symptom:** login via the real sign-in form appears to "succeed" (guard flips,
UI reaches the tabs, no error banner) yet EVERY authenticated GET returns 401,
and the api-server log shows ZERO `/api/*` requests during the whole test — only
`GET / → 404` proxy health probes.

**Why:** on web, `API_BASE` resolves to `https://$REPLIT_DEV_DOMAIN`
(`app.config.js` `extra.apiBase`), so the browser must make cross-origin calls to
the main dev domain. The headless test browser can't reach `*.replit.dev` even
though in-container `curl` to that same URL returns 200 (same root cause as the
"Replit dev domain unreachable" note — container reachability ≠ browser
reachability). So the login POST result the guard trusts is not backed by real
API access, and data never loads.

**How to apply / reliable fallback:**
- Prove server correctness with `curl` against `localhost:80/api` or the dev
  domain (both work from the container).
- Prove client render with a `screenshot` (chrome renders; only data is missing).
- Prove the actual client LOGIC by extracting the pure transform out of the
  screen into `lib/*` and unit-testing it with vitest (config includes
  `**/__tests__/**/*.test.ts`, `@`→package root). Example: squad-vault
  "By Events" grouping lives in `lib/vaultSections.ts`.
- Don't burn repeated `runTest` attempts on this — the failure mode is stable.
