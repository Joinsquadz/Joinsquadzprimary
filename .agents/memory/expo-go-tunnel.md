---
name: Expo Go tunnel via SSH (localhost.run primary, serveo fallback)
description: Expo Go on physical iPhone can't reach the Replit dev domain; fix is an SSH tunnel. localhost.run is the reliable primary; serveo.net is the fallback.
---

## The problem
`exp://30ec07b5-...expo.kirk.replit.dev` in the QR code → Expo Go on iPhone shows
"Unknown error: The request timed out." even when Safari on the same phone loads the
app fine at the same domain.

Safari works because it is a plain browser HTTPS fetch. Expo Go's connection goes
through different iOS networking stacks, and something in that path can't reliably
reach the Replit dev domain proxy.

Metro gzip, disk cache, and pre-warming do NOT fix this — the timeout is at the
TCP/TLS connection level, not the download level.

## serveo.net — works for manifest, drops bundle

Serveo works for the MANIFEST request (small, fast). The BUNDLE request (3 MB
compressed) hits a connection timeout before Metro starts streaming, and the
request never reaches Metro. Evidence: only ONE "iOS Bundled" log entry (from
pre-warm), never a second one from the actual iPhone connection.

Serveo is kept as a FALLBACK in case localhost.run doesn't connect.

## localhost.run — the reliable primary tunnel

No interstitial warning page. Better large-payload streaming support. Different
infrastructure.

SSH command:
```
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 \
    -R 80:localhost:22402 nokey@localhost.run
```

Output format to parse: `https://[a-z0-9-]+\.lhr\.life`

Example URL: `https://e39bf8300f8611.lhr.life`

**Why localhost.run over serveo:** localhost.run doesn't drop large streaming
responses. The iPhone's bundle download reaches Metro and completes.

**How to apply:** The logic lives in `artifacts/squadz-native/scripts/start.js`
(`startTunnel()` → tries localhost.run, falls back to serveo after 25s).

## /expo-go-qr page — scannable QR code in the browser
The Metro terminal QR code is often hidden by other output or hard to scan from the
workflow log. metro.config.js serves `/expo-go-qr` — an HTML page with a proper large
QR code image (via api.qrserver.com) encoding `exp://<tunnel-hostname>`.

User flow: open `https://<EXPO_DEV_DOMAIN>/expo-go-qr` on desktop → iPhone camera
scans QR from screen → Expo Go opens.

The tunnel URL is injected by start.js via `EXPO_TUNNEL_URL` env var before Metro
starts. The QR page always shows the CURRENT tunnel URL automatically after restart.

## EXPO_OFFLINE=1 — suppresses "Log in" prompt flood
Without it, Expo CLI shows an interactive "Log in / Proceed anonymously" prompt every
time a new Expo Go client connects. This floods the workflow log and hides the QR
code and ✅ banner. `EXPO_OFFLINE=1` suppresses all account/online checks cleanly.

## waitForMetro — do NOT send Expo-Platform: ios headers
The health-check polling loop must use a plain GET (no Expo headers) — any 200 or
404 confirms Metro is up. Expo-Platform: ios headers trigger the "Log in" prompt on
every 3-second poll.

## Replit preview ("Simulate on iOS") — separate issue
The preview iframe loads the Expo dev domain (`router = "expo-domain"`), which uses
the *web* bundle (not native/Hermes). Pre-warm the web bundle in parallel with iOS in
`start.js` (`downloadBundle("Web", webUrl)`). The brief blank white screen in the
preview is the normal auth-checking state — the login/onboarding screen renders
within a few seconds.

## Other notes
- `--non-interactive` or piped stdout → isTTY=false → CI mode → `CommandError`.
  Must use `stdio: "inherit"` in the Expo spawn.
- Tunnel URLs change on every restart. The /expo-go-qr page always shows the current
  one — users should bookmark that page URL, not the QR URL itself.
- ngrok and cloudflared are NOT available in this Replit environment.
- Both localhost.run and serveo.net reachable via `ssh` (pre-installed, no account).
- `EXPO_TUNNEL_URL` env var is set by start.js and read by metro.config.js for the
  /expo-go-qr page.
