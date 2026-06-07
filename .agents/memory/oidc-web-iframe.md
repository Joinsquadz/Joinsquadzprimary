---
name: OIDC sign-in inside the Replit preview iframe
description: Why Replit-OIDC web sign-in fails in the canvas/preview and how Squadz handles it
---

# OIDC web sign-in cannot complete inside the Replit preview iframe

The Replit canvas/preview embeds the Expo-web app in a cross-origin iframe. A
Replit-OIDC redirect flow cannot complete there, for two independent reasons:

1. Cross-origin iframes have partitioned/blocked web storage — `window.sessionStorage`
   access can throw a `SecurityError`, so the PKCE verifier can't be persisted.
2. The Replit login page (`replit.com/oidc/auth`) refuses to render inside a frame.

**Symptom:** tapping any sign-in button shows a generic "Sign In Failed — Something
went wrong. Please try again." because the storage/crypto work throws *before* the
redirect and is swallowed by the catch block.

**How to apply:** detect the embedded case up front (`window.self !== window.top`,
treating a cross-origin throw on `window.top` as embedded) and open the app in a
standalone top-level tab (`window.open(href, "_blank")`) with guidance, instead of
attempting the redirect. Also wrap any web-storage access (both the initiation and
the `?code` callback handler) in try/catch as a fallback. The standalone-tab path
and native (`WebBrowser.openAuthSessionAsync`) path are unaffected and work.

**Why:** this is the user's stated testing setup (Expo web in the canvas iframe);
the only way to sign in from there is to open the preview in a new browser tab.

**Note on a red herring:** ripgrep output for the auth files once rendered matched
search terms as garbled `n` (e.g. `/n/n`, `replit.comn`, `MobilenRequest`). That is
a display artifact of the search highlighting, NOT file corruption — the real files
(`artifacts/api-server/src/routes/auth.ts`, `lib/auth.ts`) are correct. Read the
file directly before believing such "corruption".
