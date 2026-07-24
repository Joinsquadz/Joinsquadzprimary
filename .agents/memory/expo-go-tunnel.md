---
name: Expo Go tunnel — split URL architecture (manifest via tunnel, bundle via Replit HTTPS)
description: Getting Expo Go on iPhone to reliably connect to Metro on Replit requires a split URL strategy: exp:// manifest via SSH tunnel, 3 MB bundle via Replit HTTPS directly.
---

## The problem
`exp://30ec07b5-...expo.kirk.replit.dev` in the QR code → Expo Go on iPhone shows
"Unknown error: The request timed out." even when Safari on the same phone loads the
app at the same domain.

Root cause: `exp://hostname` makes an HTTP (not HTTPS) request to port 80. The Replit
dev domain only serves HTTPS (port 443). The HTTP connection attempt times out.

## The fix — split URL architecture

**Manifest**: served through an SSH tunnel (serveo.net) that exposes port 80 → Metro.
Expo Go scans `exp://serveo-hostname` → HTTP → serveo → Metro → manifest returned.

**Bundle** (3 MB): NOT through the tunnel. `EXPO_PACKAGER_PROXY_URL=replit-dev-domain`
makes Metro embed Replit HTTPS URLs in the manifest's `launchAsset.url`. Expo Go
downloads the bundle directly from `https://replit-expo-dev-domain/...bundle` using
HTTPS, which works from iPhone because it's a regular HTTPS file download.

Evidence this works: after the split, Metro logs show `expo-notifications (787 modules)`
being bundled — that only happens when the main bundle executes on the phone. The API
server also received real requests from the device (`/api/squads`, `/api/events`).

## Why serveo (not localhost.run)

localhost.run anonymous sessions expire after ~2-3 minutes — too short for practical
use. serveo.net sessions last much longer. Use serveo as primary, localhost.run as 25 s
fallback.

## SSH keepalive — shorter interval is important

Use `ServerAliveInterval=15` (not 30) and `ServerAliveCountMax=6`. At 30 s the
SSH connection can time out through Replit's NAT before the next keepalive fires.

## Auto-reconnect

start.js has a `connectTunnel(isReconnect)` function that:
1. Writes `""` to `/tmp/expo-tunnel-url` while connecting (so QR page shows spinner)
2. Writes the new URL on success
3. Attaches an `exit` handler to the SSH proc that calls `connectTunnel(true)` after 3 s

## Dynamic QR page — read from file, not env var

metro.config.js reads `/tmp/expo-tunnel-url` on EVERY `/expo-go-qr` request
(via `fs.readFileSync`). This means refreshing the page always shows the CURRENT tunnel
URL, even after a reconnect (which gives a new serveo hostname).

If the file is empty (tunnel reconnecting), the page shows a spinner with
`<meta http-equiv="refresh" content="4">` so it auto-refreshes every 4 seconds.

## Pre-warm still needed

Even with Replit HTTPS for the bundle, the first Metro compile takes 5-6 s. If Expo Go
requests the bundle before it's compiled, Metro compiles on-demand (fine but slow).
Pre-warming eliminates this delay so the app loads quickly after scanning.

## Push notifications — Expo Go limitation

`expo-notifications` remote push functionality was removed from Expo Go in SDK 53.
Expo Go will show WARN banners about this. It's expected and non-fatal — the app loads
and runs normally. A development build (EAS) would be needed for push notifications.

## Key files
- `artifacts/squadz-native/scripts/start.js` — tunnel + split URL + auto-reconnect
- `artifacts/squadz-native/metro.config.js` — /expo-go-qr reads from /tmp/expo-tunnel-url

## Signal: tunnel works

Look for "iOS Bundled ... (787 modules)" or similar in Metro logs AFTER the ✅ banner.
Also look for real API requests in the api-server log (GET /api/squads, /api/events).
These confirm the app is actually running on the device.
