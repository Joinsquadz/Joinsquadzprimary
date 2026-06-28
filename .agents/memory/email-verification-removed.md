---
name: Email verification is optional (no gate)
description: Why Squadz no longer verifies email or gates anything on emailVerified
---

Email verification was REMOVED from the user experience. Signup sends no
verification email; nothing in the app (including the Pro upgrade / Stripe
checkout) gates on `users.emailVerified`.

**Why:** verification only ever gated the Pro upgrade, while the rest of the app
worked unverified. The single-use magic link kept reading as "expired" (email
security scanners pre-fetch and consume the link; 24h TTL also lapses), which
blocked paying users. Stripe Checkout already collects/receipts to the app email,
so the gate was redundant friction.

**How to apply:**
- Do NOT reintroduce an `emailVerified` check on checkout or anywhere else
  without an explicit product decision.
- The plumbing is intentionally left dormant + reversible: the `emailVerified`
  column, `GET /auth/verify-email`, `POST /auth/resend-verification`, and the
  `sendVerification` helper still exist; signup just no longer calls
  `sendVerification`. Re-enable by restoring the two register-path calls + the
  checkout gate, not by rebuilding from scratch.
- If a future feature truly needs a reachable email, prefer an in-app 6-digit
  code over a magic link (mobile: avoids scanner-consumption + browser bounce).
