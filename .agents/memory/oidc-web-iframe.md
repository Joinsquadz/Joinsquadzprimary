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

## Embedded-iframe relay (why a "working" new-tab login still looked broken)

In the canvas preview the new login tab and the iframe are **different storage
partitions**, so the session minted in the new tab never reached the embedded
app — the preview stayed on the login screen and users read that as "Sign In
Failed" even though the server flow was fine. Fix: a same-origin **postMessage
relay** (both windows are the Expo subdomain origin, so a direct
`window.opener` handle crosses the partition boundary that storage can't):
- Embedded click opens the relay tab **without `noopener`** and tags `returnTo`
  with `?squadz_auth_relay=1&squadz_auth_nonce=<random>`. The iframe keeps the
  nonce in a ref.
- The relay tab, on mount with `#token`, `postMessage`s `{token, nonce}` to
  `window.opener` (targetOrigin = its own origin) and also signs in locally as a
  fallback.
- The iframe's `message` listener accepts only same-origin messages whose nonce
  matches the ref (prevents same-origin session fixation), then signs in.
- Verified `replit.com/oidc/auth` sends **no COOP header**, so `window.opener`
  survives the OIDC round-trip. Remaining failure modes are platform-level only:
  popup blocked, or the embedder severing the opener via sandbox/COOP.
- **Why:** OIDC sign-in fundamentally cannot complete *inside* a cross-origin
  embed; either relay the token out-of-band or run the app in its own tab.

## Native (iOS / Expo Go) also goes through the bouncer

Native sign-in must use the **same server bouncer**, not a direct
`replit.com/oidc/auth` call. A native `redirect_uri` is a deep link
(`exp://…` in Expo Go, `squadz-native://…` standalone) and the Replit OIDC
provider **rejects any redirect_uri not on the repl's own domains** → "Sign In
Failed". (The old direct path was doubly broken — it also sent an empty
`client_id` because `extra.replId` was never set.)
- Client: `WebBrowser.openAuthSessionAsync(<bouncer web-login URL with
  returnTo=Linking.createURL("/login")>, returnUrl)`, then parse `#token` /
  `#error` from `result.url`. The auth session captures the bouncer's 302 to the
  custom scheme **including the fragment**.
- Server `sanitizeMobileReturnTo` must allow the native schemes: the app's own
  `squadz-native:` always, and Expo Go's `exp:` only when
  `NODE_ENV !== "production"` (its dev host is an unpinnable LAN/tunnel). Bogus
  schemes fall back to an https main-domain URL.
- **Why:** the provider's allowed-redirect rule is identical for web and native;
  routing both through a main-domain server callback is the only thing it
  accepts. `POST /api/mobile-auth/token-exchange` is now an orphaned legacy
  endpoint (no client caller) — safe but removable.

**How to apply:** any Replit-OIDC web flow served off the main domain (Expo
subdomain, or any non-`REPLIT_DOMAINS` host) must route the OIDC redirect through
a main-domain server endpoint and hand the result back out-of-band; don't send
the off-domain URL as `redirect_uri`.
