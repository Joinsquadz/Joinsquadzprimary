---
name: Squadz mobile auth flow invariants
description: Cross-file rules for the real email+password auth in squadz-native (register/login/onboarding/AuthGuard).
---

# Squadz mobile email+password auth invariants

The mobile app (`artifacts/squadz-native`) uses real email+password auth against
the shared `artifacts/api-server` backend. A few non-obvious cross-file rules:

- **Register must NOT mark the user logged in.** `applyAuthSession(token, payload, markLoggedIn)` in `AppContext.tsx` is called with `markLoggedIn=false` from `registerWithEmail` and `true` from `loginWithEmail`.
  - **Why:** signup routes to `/onboarding` after register. The `AuthGuard` in `_layout.tsx` redirects `isLoggedIn && segments[0]==="signup" → /(tabs)`. If register flipped `isLoggedIn` while still on the signup screen, that redirect would race the signup screen's `router.replace("/onboarding")` and could yank the user straight into the app, skipping onboarding.
  - **How to apply:** onboarding's `handleComplete()` calls `login()` (no token) which only flips `isLoggedIn=true` without clobbering the already-persisted session token. Keep that as the single place register's flow becomes "logged in". `onboarding` is in `AUTH_SCREENS` so the guard leaves it alone while `isLoggedIn` is still false.

- **Email confirmation is non-blocking.** `POST /auth/register` fires `void sendVerification(...)` (no await) so signup returns immediately even if SMTP is slow/down. `emailVerified` starts false; the app shows a non-blocking banner. Do not re-add an `await` there.

- **Never log raw verify/reset token URLs in production.** `sendVerificationEmail`/`sendPasswordResetEmail` only include the tokenized URL in the SMTP-not-configured log line when `NODE_ENV !== "production"` (DB stores only the SHA-256 hash of the token).

- **Leave `/api/auth/user` untouched.** It backs the web app + generated hooks. Mobile uses the separate plain `/api/auth/me` (returns `emailVerified` + `phone`).
