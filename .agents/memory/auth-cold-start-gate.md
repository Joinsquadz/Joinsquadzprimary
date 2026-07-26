---
name: Auth cold-start gating (squadz-native)
description: How the app guarantees login-vs-home on cold open; why initialRouteName failed; session validation gate; SSE 401 handling.
---

**Rule:** Cold-open routing is enforced by `Stack.Protected guard={isLoggedIn}` around all app screens in `app/_layout.tsx` — NOT by `initialRouteName` (expo-router ignores it in favor of URL-based routing; the "/" URL always mounted `(tabs)` first, causing the home-screen flash / orange placeholder avatar seen on TestFlight). `login` is the first unguarded screen so it is the fallback route while logged out.

**Session validation gate:** A stored token flips `isLoggedIn` optimistically, so a dead token used to mount home "logged in" then bounce to login. `AppContext.isSessionValidated` settles when `/api/auth/me` (with one refresh retry) resolves — success, clear, or offline-trust — and `RootLayoutNav` holds the dark boot view while `isLoggedIn && !isSessionValidated` (6s safety timeout). Offline warm relaunch still enters the app (catch path sets validated + keeps session).

**Pending onboarding trap:** With Protected routes absent, a pending-onboarding cold start falls back to `login`; AuthGuard must redirect login→/onboarding in that state (it must NOT treat every auth screen as "resumable" — only onboarding/signup/invite/add).

**SSE 401/403:** The global squad stream must not retry on 401/403 (same token can never succeed → endless "Reconnecting…" banner). It sets `squadStreamStatus="error"` (actionable tap-to-retry); token rotation or logout re-runs the connect effect.
