---
name: Supabase password reset on Replit
description: Why Supabase recovery action_link/redirectTo breaks here, and the token_hash flow that works instead.
---

# Supabase password reset (recovery) without a controllable Redirect-URL allowlist

**Rule:** Do NOT build the Supabase password-reset flow on `generateLink({type:"recovery", options:{redirectTo}})` + `action_link`. Supabase only honors `redirect_to` if the URL is in the project's **Redirect URLs allowlist**; otherwise it **silently falls back to the project Site URL** (here that was `http://localhost:3000`) and the user lands on a dead page. We cannot edit that allowlist from Replit (no Supabase dashboard / management API access).

**Working flow (server-verified token_hash, no browser redirect/fragment):**
1. `forgot-password`: `supabaseAdmin.auth.admin.generateLink({type:"recovery", email})`, read `data.properties.hashed_token`.
2. Email a link to OUR page: `{getOrigin(req)}/api/auth/reset-supabase?token_hash=<hashed_token>`.
3. `GET /api/auth/reset-supabase`: read `token_hash` from query, render form with it in a hidden field (no URL-fragment JS).
4. `POST /api/auth/reset-supabase {token_hash,password}`: `supabaseAuth.auth.verifyOtp({token_hash, type:"recovery"})` to prove email ownership, then `supabaseAdmin.auth.admin.updateUserById(user.id,{password})`.

**Why:** `verifyOtp` with the `hashed_token` validates server-side and never relies on Supabase redirecting the browser, so the allowlist is irrelevant. `getOrigin` uses `x-forwarded-host`, so when the app hits the public domain the email link is publicly reachable.

**How to apply:** Any Supabase email-action flow here (recovery, invite, magiclink, email-change) should use the `hashed_token` + server `verifyOtp` pattern, not `action_link`/`redirectTo`.

**Debugging note:** "Sign in failed / incorrect password" with a healthy Supabase user is almost always a real credential mismatch, NOT a code bug. Prove it definitively: admin-set a known password (`PUT /auth/v1/admin/users/:id`), then hit our `/api/auth/login` AND Supabase `/auth/v1/token?grant_type=password` directly. If both 200, the login system is fine and the user's stored password simply doesn't match what they type. Inspect the live action_link's `redirect_to` query param to catch the localhost fallback.
