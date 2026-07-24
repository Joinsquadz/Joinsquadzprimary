---
name: Expo Go tunnel via serveo.net
description: Expo Go on physical iPhone times out when pointed at the Replit dev domain; fix is a serveo.net SSH tunnel + /expo-go-qr page.
---

## The problem
`exp://30ec07b5-...expo.kirk.replit.dev` in the QR code → Expo Go on iPhone shows
"Unknown error: The request timed out." even when Safari on the same phone loads the
app fine at the same domain.

Safari works because it is a plain browser HTTPS fetch. Expo Go's connection goes
through different iOS networking stacks / potentially Expo's own relay infrastructure,
and something in that path can't reliably reach the Replit dev domain proxy.

Metro gzip, disk cache, and pre-warming do NOT fix this — the bundle is served in
<500ms but Expo Go never even gets the manifest. The timeout is at the TCP/TLS
connection level, not the download level.

## The fix — serveo.net SSH tunnel
Before starting Expo, spawn:
```
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
    -R 80:localhost:22402 serveo.net
```
Parse the printed `https://<hash>.serveousercontent.com` URL, then set
`EXPO_PACKAGER_PROXY_URL=<serveo-url>` in the Expo env. Metro prints the serveo URL
in the QR code instead of the Replit dev domain. Expo Go scans → connects via
serveo → no timeout.

**Why:** Serveo is a straightforward SSH reverse tunnel (no Replit proxy in the
path). Expo Go connects cleanly.

**How to apply:** The logic lives in `artifacts/squadz-native/scripts/start.js`
(the `startServeoTunnel()` function). The tunnel URL is random per restart —
always read it from the ✅ banner or the `/expo-go-qr` page URL in the Expo workflow tab.

## Serveo browser warning page — NOT a problem
Serveo shows an HTML "Continue to Site" warning only for browser requests (Accept: text/html).
Expo Go sends `Accept: application/expo+json, application/json` → bypasses the warning
and gets the Metro manifest directly. Bundle downloads (no text/html Accept) also bypass it.
Confirmed by curl test: both manifest and 18MB bundle download cleanly through the tunnel.

## /expo-go-qr page — scannable QR code in the browser
The Metro terminal QR code is often hidden by other output or hard to scan from the
workflow log. metro.config.js serves `/expo-go-qr` — an HTML page with a proper large QR
code image (via api.qrserver.com) encoding `exp://<serveo-hostname>`.

User flow: open `https://<EXPO_DEV_DOMAIN>/expo-go-qr` on desktop → iPhone camera
scans QR from screen → Expo Go opens.

The tunnel URL is injected by start.js via `EXPO_TUNNEL_URL` env var before Metro starts.

## EXPO_OFFLINE=1 — suppresses "Log in" prompt flood
Without it, Expo CLI shows an interactive "Log in / Proceed anonymously" prompt every
time a new Expo Go client connects. This floods the workflow log and hides the QR code
and ✅ banner. `EXPO_OFFLINE=1` suppresses all account/online checks cleanly.

## waitForMetro — do NOT send Expo-Platform: ios headers
The health-check polling loop originally used `Expo-Platform: ios, Expo-API: expo`
headers to check if Metro was up. This triggers the "Log in" prompt on every 3-second
poll. Use a plain GET (no Expo headers) — any 200 or 404 confirms Metro is running.

## Replit preview ("Simulate on iOS") — separate issue
The preview iframe loads the Expo dev domain (`router = "expo-domain"`), which uses
the *web* bundle (not native/Hermes). Pre-warm the web bundle in parallel with iOS in
`start.js` (`downloadBundle("Web", webUrl)`). The brief blank white screen in the
preview is the normal auth-checking state (root layout returns null while fonts load +
auth restores) — the login/onboarding screen renders within a few seconds.

## Other notes
- `--non-interactive` or piped stdout → isTTY=false → CI mode → `CommandError`.
  Must use `stdio: "inherit"` in the Expo spawn.
- Serveo URL changes on every restart. Tunnel dies if SSH drops; Metro keeps
  running but the QR code becomes stale — workflow restart reconnects.
- ngrok and cloudflared are NOT available in this Replit environment.
- localhost.run IS available as backup (`ssh nokey@localhost.run`) but has no warning page.
- serveo.net reachable via `ssh` (pre-installed). No account needed.
- `EXPO_TUNNEL_URL` env var is set by start.js and read by metro.config.js for the /expo-go-qr page.
