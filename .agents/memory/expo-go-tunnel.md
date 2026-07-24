---
name: Expo Go tunnel via serveo.net
description: Expo Go on physical iPhone times out when pointed at the Replit dev domain; fix is a serveo.net SSH tunnel.
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
always read it from the ✅ banner in the Expo workflow tab.

## Replit preview ("Simulate on iOS") — separate issue
The preview iframe loads the Expo dev domain (`router = "expo-domain"`), which uses
the *web* bundle (not native/Hermes). The fix: pre-warm the web bundle alongside
the iOS bundle in `start.js` (`downloadBundle("Web", webUrl)` in parallel with iOS).

## Other notes
- `--non-interactive` or piped stdout → isTTY=false → CI mode → `CommandError`.
  Must use `stdio: "inherit"` in the Expo spawn.
- Serveo URL changes on every restart. Tunnel dies if SSH drops; Metro keeps
  running but the QR code becomes stale — workflow restart reconnects.
- ngrok and localtunnel are NOT available in this Replit environment.
- Cloudflared is NOT available either.
- serveo.net reachable via `ssh` (pre-installed). No account needed.
