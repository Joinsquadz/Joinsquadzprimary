---
name: Auth provider constraints (Squadz)
description: Why "switch to Clerk for Google/Facebook/SMS" is not deliverable as asked; what the app actually uses.
---

# Auth: what's possible here vs. what was asked

The app authenticates with **Replit Auth (OIDC against replit.com/oidc)** — server sessions in `sessionsTable` keyed by `sid` (web: httpOnly cookie; mobile: Bearer token in AsyncStorage via PKCE token-exchange).

The user wanted Google + Facebook login + **SMS/text OTP**. Two hard constraints make the "just switch to Clerk" answer wrong:

1. **Migration Replit Auth → Clerk is not supported** (clerk-auth skill: tell the user, stop, do not hand-roll a migration).
2. **Replit-managed Clerk does NOT support SMS/phone sign-in** (nor Facebook in its default provider set). It supports email/password + Google/GitHub/Apple/X only.

**Implication:** delivering Google + Facebook + SMS OTP means a **custom auth build** (own OAuth apps for Google/Facebook + an SMS provider like Twilio) that replaces the current Replit Auth — a large, security-sensitive effort. Don't re-recommend Clerk for the SMS requirement; surface the custom-build tradeoff and get an explicit decision before building.
