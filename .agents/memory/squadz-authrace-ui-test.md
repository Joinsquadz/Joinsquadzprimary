---
name: Squadz cold-start auth-race UI test
description: How to drive an authenticated cold-start 401 auth-race UI test on squadz-native web without tripping the login rate limiter
---

Testing the list screens' (SquadZ/Events/Messages) slow-login recovery via `runTest` on the Expo **web** build.

**Do NOT log in through the UI.** The agent retries the "Log in" form when it can't confirm success, and the server login limiter (`rateLimited(req,"login",20)` in `artifacts/api-server/src/routes/auth.ts`) 429s → the test can never reach the authenticated shell (`status: "unable"`). This is the #1 failure mode.

**Instead simulate the cold start by seeding the token into `localStorage`:**
- On web, `@react-native-async-storage/async-storage` writes to `window.localStorage` with the key **as-is** (no prefix). The token key is `@squadz/authToken`.
- Cold-start restore (`AppContext` `AsyncStorage.multiGet([AUTH_TOKEN_KEY, ONBOARDING_PENDING_KEY])`): a token present + `@squadz/onboardingPending` **absent** ⇒ `setIsLoggedIn(true)` and it drops straight into the app. (An account registered via curl never sets `onboardingPending`, so it's absent.)
- Plan order: new context → goto `/` (establish origin) → `localStorage.setItem('@squadz/authToken', <token>)` → `page.route` 401 on the list endpoints → **reload** (= the cold start).

**What to intercept:** `page.route` returns 401 for URLs containing `/api/events`, `/api/squads`, `/api/conversations`. **Never** intercept `/api/auth/*` — `/api/auth/me` must succeed or the token is treated as dead and the app logs out.

**Why the race fires:** the 401 auth-race guard is in `lib/vaultAuthRace.ts` (MAX_AUTH_RETRIES=8, AUTH_RETRY_DELAY_MS=600). While `isLoggedIn || isAuthRestoring`, a list 401 = "loading" render (spinner, never empty state); after retries exhaust = "error" render with "Try again". Messages errors only when BOTH events(AppContext) + conversations errored and list empty, so keep both 401.

Assertions: during race, spinner + NOT empty text (`No squads yet`/`No trips yet`/`No events yet`/`No messages yet`); after ~7s, error text (`Couldn't load your squads`/`...your plans`/`...messages`) + `Try again`; then `page.unroute` + click Try again ⇒ recover to seeded content. Seed a squad + event + one event-chat message first so recovery has real data.

Token must authenticate on `/api/auth/me` (JWT ~1h TTL) — verify with curl before the run; re-login/register if expired.
