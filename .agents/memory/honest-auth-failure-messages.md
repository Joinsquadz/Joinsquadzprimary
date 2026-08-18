---
name: Honest auth failure messages & session recovery
description: Only HTTP 401 means bad credentials; a confirmed-session 401 must invalidate, and every protected read must go through the shared auth-aware fetch.
---

Two failure modes that look like each other to a user but are opposite bugs:

1. **"Incorrect email or password." must require an actual HTTP 401.** A
   login handler shaped `if (!res.ok || !data.token || !data.user)` accuses the
   user of a typo when the service returned 2xx with a malformed body, a 500, or
   a rate-limit. Classify on status: 401 = credentials; 2xx without a usable
   token+user = service/contract failure (report to monitoring, never echo the
   body, email, or token); everything else = generic/rate-limit/server message.

2. **A 401 on protected data after a confirmed session means the session is
   dead, not that the account is empty.** Rendering the empty state instead
   shows a returning user a "fresh account" home screen. But the same 401 before
   startup validation finishes is the normal token-restoration race and must
   still retry — so the decision is (not an auth route) AND (session validated)
   AND (a token exists), not the status alone.

**Why:** these shipped together as one incident — a blank/empty home plus a
login screen blaming the password, when the real causes were an expired session
and a server-side query error.

**How to apply:**
- Screens must not hand-roll `fetch(API_BASE + path, authHeaders)` for protected
  reads; that silently bypasses the shared 401/refresh/expiry handling. Expose
  the context's auth-aware fetch and use it, or the recovery path only covers
  whichever screens happened to opt in.
- After a successful login, set the "session validated" **ref** synchronously in
  the same turn as the state — reads kicked off by the new token otherwise fall
  into the cold-start grace period and treat a real 401 as retryable.
