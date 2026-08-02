---
name: Squadz pending deep-link codes
description: How squad AND event invite codes survive cold starts during signup, and the clear-on-terminal-outcome rule.
---

# Pending deep-link invite codes (squadz-native)

Both squad invites (`/squad/join?code=`) and event invites (`/join/<code>`) persist their code to AsyncStorage (`lib/pendingInvite.ts`, 24h TTL) when a logged-out user is bounced to login. Router params alone are NOT enough — a cold start mid-signup loses them.

**Rules:**
- Save the code *before* redirecting to `/login`.
- Login and onboarding completion both fall back to the stored code when no route params exist. Precedence: stored squad code first, then stored event code (deterministic policy).
- Clear the stored code on EVERY terminal outcome, not just the happy join: success, **409 already-going**, 404 code-not-found, 410 cancelled. A missed terminal branch (the 409 path was missed once) loops the user back to the join screen after every login until the TTL expires.

**Why:** invited friends are the main growth loop; losing the invite context mid-signup lands them on an empty home screen.
