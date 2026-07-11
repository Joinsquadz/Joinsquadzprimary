# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `SUPABASE_DB_URL` (preferred) or `DATABASE_URL` — Postgres connection string. The db layer (`lib/db/src/connection.ts`) prefers `SUPABASE_DB_URL` and falls back to `DATABASE_URL`.
  - The database lives on **Supabase**. Use the **Session pooler** connection string (`aws-*.pooler.supabase.com:5432`), NOT the Direct connection (`db.<ref>.supabase.co`) — the direct host is IPv6-only and unreachable from Replit (IPv4-only).
  - The connection string is parsed into discrete `pg` fields (host/user/password/…), so a raw, un-encoded Supabase password (which may contain `/`, `@`, `:`) works without percent-encoding.

### External service environment variables

All services degrade gracefully when their env vars are absent (Supabase Auth falls back to session-based auth, email falls back to SMTP, storage falls back to Replit Object Storage, analytics/monitoring are no-ops).

**API server** (`artifacts/api-server`):

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (admin, never expose to clients) |
| `SUPABASE_STORAGE_BUCKET` | **Private** bucket for vault photos / message attachments / feed media (default: `squadz-media`). Served only via auth-gated signed-URL redirect. |
| `SUPABASE_PUBLIC_BUCKET` | **Public** bucket for profile avatars (default: `squadz-avatars`). Must have its `public` flag = true so a plain `<Image>` (no auth header) can load the permanent public URL. Auto-created on first avatar upload if missing. |
| `SENDGRID_API_KEY` | SendGrid API key — primary email delivery |
| `SENDGRID_FROM` | Sender address for transactional email |
| `TWILIO_ACCOUNT_SID` | Twilio account SID for SMS OTP |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_FROM_NUMBER` | Twilio "from" phone number (E.164 format) |
| `POSTHOG_API_KEY` | PostHog project API key (server-side analytics) |
| `POSTHOG_HOST` | PostHog instance URL (optional, defaults to `https://app.posthog.com`) |
| `SENTRY_DSN` | Sentry DSN for server error tracking |

**Mobile app** (`artifacts/squadz-native`):

| Variable | Purpose |
| -------- | ------- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (same as server) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog project API key (client-side analytics) |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog instance URL (optional) |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for mobile error tracking |

### Deep links (shared squad links → open the app)

`https://joinsquadz.com/squad/join-public?id=<id>` opens the native app via iOS universal links / Android app links. The association files are served by the api-server at `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (the proxy routes `/.well-known` to it). Set these env vars at deploy time so the links actually verify against the signed builds (defaults are placeholders that serve valid JSON but won't verify):

- `IOS_APP_ID` — `<TEAM_ID>.com.squadz.app` (Apple Developer Team ID + bundle id)
- `ANDROID_SHA256_CERT_FINGERPRINTS` — comma-separated SHA-256 signing-cert fingerprints (from Play App Signing / your keystore)
- `ANDROID_PACKAGE_NAME` — optional override (defaults to `com.squadz.app`)

When the app isn't installed, the same URL falls back to the marketing landing page (every web route renders `Landing`).

## Automated UI tests (authenticated mobile-app screens)

The Playwright UI tester (`runTest`) CAN now exercise signed-in `artifacts/squadz-native` web flows. On web, `resolveApiBase()` (`artifacts/squadz-native/lib/api.ts`) returns `""` (same-origin) instead of the absolute dev domain, and `artifacts/squadz-native/metro.config.js` runs a dev-only Metro middleware that reverse-proxies `/api/*` from the Expo web dev server to the api-server via the shared proxy (`localhost:80`). So the headless browser reaches the API same-origin — no cross-origin hop to `*.replit.dev` (which it cannot make).

To run an authenticated UI test:

1. Ensure the `artifacts/api-server: API Server` and `artifacts/squadz-native: expo` workflows are running.
2. Seed a login: `curl -sX POST http://localhost:80/api/auth/register -H 'content-type: application/json' -d '{"email":"uitest+<unique>@example.com","password":"Test1234!","name":"UI Tester"}'` (registration is idempotent-ish; use a unique email per run). Note the email/password.
3. In a `runTest` plan: create a context, go to `/`, use the onboarding "Log in" flow with those creds, then assert an authenticated screen (SquadZ / Profile / vault) renders real data (200s, not a perpetual spinner or 401).

Native builds and the production static server (`server/serve.js`) are unaffected — native still uses the absolute API base, and the Metro proxy only exists under `expo start`.

### Slow-login / cold-start 401 auth-race recovery (SquadZ, Events, Messages)

Confirms the wired-up list screens survive a cold-start auth race: they stay on a loading spinner (never flash their empty state) while list fetches 401, show a "Try again" retry UI once the retry loop (`MAX_AUTH_RETRIES` in `lib/vaultAuthRace.ts`) is exhausted, and recover to real data once the 401s stop. Pure unit tests live in `artifacts/squadz-native/lib/__tests__/listAuthRace.test.ts`; this is the on-device (web) integration confirmation.

**Do NOT drive this via the UI "Log in" flow** — the server login limiter (`rateLimited(req,"login",20)`, `artifacts/api-server/src/routes/auth.ts`) will 429 after repeated agent sign-in attempts and the test can never reach the shell. Instead simulate the cold start by seeding the token into `localStorage`:

1. Ensure the `artifacts/api-server: API Server` and `artifacts/squadz-native: expo` workflows are running, and seed an account + data (a squad, an event, one event-chat message) so recovery has real content to render.
2. In a `runTest` plan: new context → go to `/` (establish origin) → `window.localStorage.setItem('@squadz/authToken', '<token>')` (exact key the app restores on boot; with no `@squadz/onboardingPending` it drops straight into the authenticated shell) → `page.route` the list endpoints to return 401.
3. Intercept `/api/events`, `/api/squads`, `/api/conversations` → 401; **never** intercept `/api/auth/*` (so `/api/auth/me` keeps the session logged in). Reload = cold start.
4. Assert: during the race each screen shows a spinner and NOT its empty text (`No squads yet` / `No trips yet` / `No events yet` / `No messages yet`); after ~7 s the error UI appears (`Couldn't load your squads` / `Couldn't load your plans` / `Couldn't load messages` + `Try again`); then `page.unroute` and click "Try again" to confirm recovery to the seeded squad/event.

## Staging Smoke Tests

### Push notifications end-to-end

Send a real push notification to a known test device and verify the Expo ticket status:

```sh
TEST_PUSH_TOKEN=ExponentPushToken[xxxx] pnpm --filter @workspace/scripts run smoke-test-push
```

- Obtain a test token by logging in to the Squadz mobile app on a real device (or the Expo Go client) and copying the token from the push-notification permission prompt / device settings screen.
- The script validates the token format, sends one notification via the Expo Push API, and prints `TICKET OK` or a detailed error.
- By default it also waits 20 s and fetches the Expo receipt (checks that APNs/FCM accepted delivery). Set `SKIP_RECEIPT_CHECK=1` to skip that step.
- Exit code `0` = PASS, exit code `1` = FAIL (token invalid, quota exceeded, device not registered, etc.).
- Source: `scripts/src/smoke-test-push.ts`

### Deep links open the app (universal links / app links)

Pre-launch check that a shared squad link (`https://joinsquadz.com/squad/join-public?id=<id>`) actually opens the native app. This has an automatable half (the association files are well-formed and non-placeholder) and a manual half (real-device taps), because the identity values must match the *signed* builds and a real device must be observed opening the app.

**Automated check — run against the deployed environment:**

```sh
SQUADZ_BASE_URL=https://joinsquadz.com pnpm --filter @workspace/scripts run smoke-test-deeplinks
```

- Fetches `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` and asserts: HTTP 200 with no redirect, `Content-Type: application/json`, AASA `appID` is in `<TEAM_ID>.<BUNDLE_ID>` form and is **not** the `TEAMID.*` placeholder, paths/components cover `/squad/join-public`, and assetlinks has at least one valid colon-hex SHA-256 fingerprint (not the empty placeholder).
- Exit code `0` = PASS (well-formed + non-placeholder), `1` = FAIL (misconfigured or env vars unset). A FAIL on the placeholder checks means `IOS_APP_ID` / `ANDROID_SHA256_CERT_FINGERPRINTS` are not set for that environment.
- Source: `scripts/src/smoke-test-deeplinks.ts`

**Prerequisites (set in the deployment environment for the signed builds):**

- `IOS_APP_ID` = `<TEAM_ID>.com.squadz.app` — from Apple Developer (Team ID + bundle id).
- `ANDROID_SHA256_CERT_FINGERPRINTS` = comma-separated SHA-256 signing-cert fingerprints — from Play App Signing (Play Console → App integrity) or your keystore.

**Manual round-trip (cannot be automated — requires real hardware):**

1. Apple AASA validator: `https://app-site-association.cdn-apple.com/a/v1/joinsquadz.com` (Apple's CDN fetches and validates your AASA).
2. Google Digital Asset Links tester: <https://developers.google.com/digital-asset-links/tools/generator> (point it at `joinsquadz.com` + `com.squadz.app`).
3. On a real **iOS** device with the signed build installed, tap `https://joinsquadz.com/squad/join-public?id=<id>` — it must open the app on the join-public screen (not Safari).
4. On a real **Android** device with the signed build installed, run `adb shell pm verify-app-links --re-verify com.squadz.app`, then `adb shell pm get-app-links com.squadz.app` — expect the domain to show `verified`. Then tap the link — it must open the app.

**Pass/fail log:**

| Date | Env | Automated check | iOS device tap | Android device tap | Notes |
| ---- | --- | --------------- | -------------- | ------------------ | ----- |
| _pending_ | production | — | — | — | Awaiting real `IOS_APP_ID` / `ANDROID_SHA256_CERT_FINGERPRINTS` from signed builds, then physical-device verification. |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/squadz-native` — the Squadz **mobile app** (Expo). This is the actual product; build all new user features here.
- `artifacts/squadz` — the **web marketing landing page** only (not an app). Entry: `src/pages/Landing.tsx`; brand tokens/font in `src/lib/data.ts` (`T`, `font`), logo in `src/components/SquadzIcon.tsx`.
- `artifacts/api-server` — Express API. Routes in `src/routes/*` registered via `src/routes/index.ts`; persistence helpers in `src/storage.ts`.
- `lib/db/src/schema/*` — Drizzle table definitions (source of truth for DB schema), re-exported from `schema/index.ts`.

## Architecture decisions

- **Mobile is the product; web is marketing.** The web app is a single informational landing page with a real waitlist + app-store "coming soon" CTAs. Every web route renders `Landing` (no in-app web screens, no auth guard).
- **App feature routes are NOT in the OpenAPI spec.** They use inline Zod validation on the server + plain `fetch` on the client (no Orval codegen). The waitlist endpoints follow this convention. Only add to `openapi.yaml` for contracts that genuinely need generated hooks/schemas.
- **Waitlist is idempotent.** `addToWaitlist` uses `onConflictDoNothing` on the unique `email`, so re-submits return `{ok:true}` without duplicating rows.
- **Waitlist count is real, never inflated.** The landing page shows the true `/api/waitlist/count`, and falls back to a non-numeric label below a small threshold rather than fabricating social proof.

## Product

Squadz is a mobile app for friend groups: create squads, find the time everyone is free (overlap heatmap → best time), plan events with RSVPs, group chat tied to the plan, a shared photo vault, and cost splitting. The web presence is a marketing landing page that drives waitlist signups ahead of the iOS/Android launch.

## User preferences

- Mobile app is the ONLY product. Build new features mobile-only. The web app must stay an informational marketing landing page (no in-app web screens).
- **Two separate apps live in this one project — never confuse them:**
  - **Website** = `artifacts/squadz` (marketing landing page).
  - **Mobile App** = `artifacts/squadz-native` (the actual product).
- **All requests default to the Mobile App.** Only touch the website (`artifacts/squadz`) when the user explicitly says so. Do not ask "Website or Mobile App?" — assume mobile unless told otherwise.
- **Route every request to exactly one app.** A change to one must not touch the other unless the user explicitly asks for both. The shared `artifacts/api-server` backend is the only intentionally-shared piece.

## Gotchas

- **Profile avatars need a PUBLIC bucket.** Avatars render via a plain `<Image>` with no Authorization header (`components/UserAvatar.tsx`), so they must be served from a permanent, publicly-readable URL. A private Supabase bucket's `getPublicUrl()` returns a link that 400s — the photo uploads fine but never displays. Public uploads (`isPublicAccess: true`) go to `SUPABASE_PUBLIC_BUCKET`; private assets (vault/attachments/feed) stay in `SUPABASE_STORAGE_BUCKET` and load via auth-gated signed-URL redirect (they pass auth headers through `expo-image`).
- Verify web changes with `pnpm --filter @workspace/squadz run typecheck` (NOT `build`, which needs workflow-provided `PORT`/`BASE_PATH`).
- After changing `lib/db` schema, run `pnpm --filter @workspace/db run push` and restart the api-server workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
