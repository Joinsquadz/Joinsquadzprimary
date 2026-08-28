---
name: Auth cold-start gating (squadz-native)
description: Cold-open routing, session validation, token refresh durability, lifecycle races, and SSE recovery.
---

**Rule:** Cold-open routing is enforced by `Stack.Protected guard={isLoggedIn}` around all app screens in `app/_layout.tsx` — NOT by `initialRouteName` (expo-router ignores it in favor of URL-based routing; the "/" URL always mounted `(tabs)` first, causing the home-screen flash / orange placeholder avatar seen on TestFlight). `login` is the first unguarded screen so it is the fallback route while logged out.

**Session validation gate:** A stored token flips `isLoggedIn` optimistically, so a dead token used to mount home "logged in" then bounce to login. `AppContext.isSessionValidated` settles when `/api/auth/me` (with one refresh retry) resolves — success, clear, or offline-trust — and `RootLayoutNav` holds the dark boot view while `isLoggedIn && !isSessionValidated` (6s safety timeout). Offline warm relaunch still enters the app (catch path sets validated + keeps session).

**Pending onboarding trap:** With Protected routes absent, a pending-onboarding cold start falls back to `login`; AuthGuard must redirect login→/onboarding in that state (it must NOT treat every auth screen as "resumable" — only onboarding/signup/invite/add).

**SSE 401/403:** The global squad stream must not retry on 401/403 (same token can never succeed → endless "Reconnecting…" banner). It sets `squadStreamStatus="error"` (actionable tap-to-retry); token rotation or logout re-runs the connect effect.

**Refresh invariant:** Protected requests, cold start, app resume, and SSE share one deduplicated refresh coordinator. A rotated refresh/access pair is persisted refresh-first and access-last, then published to request-visible state. All durable token mutations are serialized, and lifecycle generation checks surround the awaited write so a refresh finishing after logout or account switching cannot restore stale credentials. Definitive refresh rejection clears the session; timeout, throttling, provider 5xx, and storage failure preserve a previously validated session.

**Why:** Refresh-token rotation invalidates the old pair. Retrying before durable persistence can strand the next launch, while concurrent refreshes or a stale completion after logout can overwrite the only valid pair or resurrect the wrong account.

**How to apply:** Any new authenticated transport must use the shared coordinator rather than implementing its own refresh. Server-side OIDC refresh must remain serialized per session ID, and every locked session read/write/delete must use the transaction executor that acquired the advisory lock. Calling root DB helpers from inside the lock can exhaust the pool because each refresh would hold one connection while waiting for another.
