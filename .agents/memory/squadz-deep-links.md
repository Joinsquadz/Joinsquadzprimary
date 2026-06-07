---
name: Squadz deep links / universal links
description: How shared squad https links open the native app (iOS universal links / Android app links) and where association files live.
---

# Shared squad links → open the app

Share link form: `https://getsquadz.com/squad/join-public?id=<id>` (target route `app/squad/join-public.tsx`).

## Where association files are served
The `.well-known` association files are served by the **api-server**, NOT the squadz web app, and mounted at the app ROOT (not under `/api`):
- `/.well-known/apple-app-site-association`
- `/.well-known/assetlinks.json`

The shared proxy routes `/.well-known` to the api-server via an extra entry in its artifact.toml `paths` (`["/api", "/.well-known"]`). Serving them from Express guarantees `Content-Type: application/json` (required by Android's Digital Asset Links verifier) and dodges the squadz static SPA rewrite (`/* -> /index.html`).

**Why api-server, not squadz/public:** the squadz static deploy rewrites every unknown path to index.html and would not reliably set JSON content-type on the extensionless AASA file.

## Identity values are env-injected (deploy time)
The route builds the JSON dynamically from env so unknown-until-signed values need no code change:
- `IOS_APP_ID` → `<TEAM_ID>.com.squadz.app` (default placeholder `TEAMID.com.squadz.app`)
- `ANDROID_SHA256_CERT_FINGERPRINTS` → comma-separated SHA-256 fingerprints (default empty array)
- `ANDROID_PACKAGE_NAME` → optional, defaults `com.squadz.app`

Until set, files are valid JSON but won't verify against a real build.

## app.json config
- iOS: `ios.associatedDomains: ["applinks:getsquadz.com"]`
- Android: `android.intentFilters` with `autoVerify: true`, scheme `https`, host `getsquadz.com`, `pathPrefix: /squad/join-public`.

## Fallback
App not installed → the https URL opens in browser → squadz web renders `Landing` for every route (marketing page). Expo Router auto-matches the incoming URL path to the file route, so the query `?id=` lands in `useLocalSearchParams`.
