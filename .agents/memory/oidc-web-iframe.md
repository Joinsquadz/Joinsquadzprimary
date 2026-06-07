---
name: Replit-OIDC web sign-in for the Expo app (subdomain + iframe)
description: Why Replit-OIDC web sign-in fails for the Expo web app and how Squadz solves it with a server-side bouncer
---

# Replit-OIDC web sign-in for the Expo web app

Two independent problems break a naive client-side Replit-OIDC redirect flow for
the Expo **web** app, and BOTH must be solved:

1. **redirect_uri rejection (the real blocker).** The Expo web app is served on a
   subdomain (`…expo.kirk.replit.dev`) that is **NOT** in `REPLIT_DOMAINS` (only
   the main `…kirk.replit.dev` is). The Replit OIDC provider rejects a
   `redirect_uri` on the Expo subdomain, so no `?code` ever comes back and no
   token-exchange ever hits the server. **Tell-tale sign:** user sees "Sign In
   Failed" but the api-server log shows zero `/api/mobile-auth/...` requests.
2. **iframe framing.** The Replit canvas/preview embeds the app cross-origin;
   `replit.com/oidc/auth` refuses to render in a frame, and framed storage is
   partitioned.

**Why a passing e2e test can hide problem #1:** the testing harness's
`testReplitAuth:true` swaps in a fake IdP that accepts ANY redirect_uri, so the
real subdomain rejection never surfaces in tests. Trust a real-domain probe over
a green auth test here.

## Solution in this repo: server-side bouncer

Routes in `artifacts/api-server/src/routes/auth.ts`:
- `GET /api/mobile-auth/web-login?returnTo=<appUrl>` — runs the OIDC handshake
  server-side (PKCE/state/nonce in short-lived httpOnly `m_*` cookies) with
  `redirect_uri = ${getOrigin(req)}/api/mobile-auth/web-callback`. Because the
  client calls this on `API_BASE` (= `https://${REPLIT_DEV_DOMAIN}`, the MAIN
  domain, set via `app.config.js` → `extra.apiBase`), the redirect_uri is always
  on an allowed domain.
- `GET /api/mobile-auth/web-callback` — exchanges the code, mints a session
  `sid`, and 302-redirects to the validated `returnTo` with `#token=<sid>` (or
  `#error=auth`).

`returnTo` is validated by `sanitizeMobileReturnTo` against an allowlist built
from `REPLIT_DEV_DOMAIN` + `REPLIT_EXPO_DEV_DOMAIN` + `REPLIT_DOMAINS` (https +
hostname match) to prevent open redirect; any fragment is stripped before the
token is appended.

Client (`artifacts/squadz-native/app/login.tsx`): the web path just opens the
`web-login` URL — in a **new tab** when embedded (`isEmbeddedWeb()` =
`window.self !== window.top`, cross-origin throw counts as embedded), since the
login page can't be framed — and on mount reads `#token`/`#error` from the URL
fragment, then `history.replaceState` to strip it (prevents replay). No
client-side PKCE/sessionStorage on web anymore. The **native**
(`WebBrowser.openAuthSessionAsync`) path is unchanged.

**How to apply:** any Replit-OIDC web flow served off the main domain (Expo
subdomain, or any non-`REPLIT_DOMAINS` host) must route the OIDC redirect through
a main-domain server endpoint and hand the result back out-of-band; don't send
the off-domain URL as `redirect_uri`.
