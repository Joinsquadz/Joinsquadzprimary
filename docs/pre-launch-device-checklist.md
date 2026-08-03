# Squadz — Pre-Launch Device Verification Checklist

> **Who**: A developer with Expo Go installed on a real iPhone, plus access to the
> Replit secrets panel and the RevenueCat dashboard.  
> **When**: Run before every TestFlight / App Store submission.  
> **Scope**: Paths that cannot be exercised by the automated Expo-web E2E suite.

---

## 0  Environment prerequisites

Set these secrets in the Replit environment before testing (Settings → Secrets):

| Secret | Notes |
|---|---|
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` | Public iOS SDK key from RC dashboard → App → API keys |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | Public Android SDK key (same location) |
| `REVENUECAT_API_KEY` | Server-side secret (RC dashboard → Project → API keys → Secret key) |
| `REVENUECAT_WEBHOOK_AUTH` | Self-generated; must match the `Authorization` header set on the RC webhook (RC dashboard → Project → Webhooks) |
| `IOS_APP_ID` | `<TEAM_ID>.com.squadz.app` — from Apple Developer portal once the app is registered |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | Colon-separated SHA-256 fingerprints from Play Console once the keystore is uploaded |

The app will still run without these but purchases will 503, the webhook will be rejected, and universal links won't verify against a real build.

**Webhook URL** (to paste in the RC dashboard under *Project → Webhooks → URL*):
- Sandbox testing → `https://<REPLIT_DEV_DOMAIN>/api/revenuecat/webhook`
- Production → `https://joinsquadz.com/api/revenuecat/webhook`

---

## 1  Push notifications

Start the app on an iPhone via Expo Go + the serveo SSH tunnel (see
`.agents/memory/expo-go-tunnel.md`). Log in, create or join a squad. Have a
second device or account ready to send events.

### 1a  Squad invite
- [ ] User A invites User B to a squad
- [ ] User B receives a push notification while app is **backgrounded**
- [ ] Tapping the notification opens the squad screen (not squad home)

### 1b  Event reminder ("starting soon")
- [ ] Create an event starting ~30 minutes from now
- [ ] RSVP "going" from a second account
- [ ] Wait for the reminder scanner window (runs every 5 min); User B receives
  a push while backgrounded
- [ ] `reminderSentAt` is only written **after** the push succeeds
  (verify in server logs: look for `"Event reminder sent"` log entry)

### 1c  Availability poll response
- [ ] Host creates an availability poll
- [ ] A member submits a response
- [ ] Host receives a push: "Someone responded to your poll"
- [ ] Tapping navigates to the availability screen for that poll

### 1d  Chat message
- [ ] User A sends a message in a squad conversation
- [ ] User B (backgrounded) receives a push with the message body
- [ ] Tapping opens the correct conversation

### 1e  Notification preferences respected
- [ ] In Settings → Notifications, toggle **Messages** off
- [ ] User A sends another chat message
- [ ] User B receives **no** push (confirm no delivery in server logs)
- [ ] Re-enable and confirm delivery resumes

### 1f  Squad mute respected
- [ ] Mute a squad from the squad detail screen
- [ ] Trigger a squad-join event
- [ ] Confirm **no** push arrives for that squad while muted
- [ ] Unmute and confirm next event delivers

### 1g  Stale token cleanup
- [ ] Uninstall and reinstall the app (new Expo push token issued)
- [ ] Send a push to the old token; confirm `DeviceNotRegistered` is caught
  and the stale token is cleared (server log: `"Clearing stale push token"`)

---

## 2  RevenueCat in-app purchase (Squadz+)

> Requires sandbox Apple ID and the RC sandbox environment. Set RC dashboard to
> **Sandbox** mode for these tests.

### 2a  Standard purchase
- [ ] Open Profile → Upgrade to Squadz+
- [ ] Tap "Subscribe" — complete the sandbox purchase sheet
- [ ] RC webhook fires → server sets `is_squadz_plus = true`
  (verify: `GET /api/subscription` returns `{ isSquadzPlus: true }`)
- [ ] Pro ring appears on the profile screen without a manual refresh

### 2b  Founding member purchase
- [ ] Repeat 2a but select the **Founding Member** package (if still available)
- [ ] Founding ledger entry is created (`rc:<original_transaction_id>` key)
- [ ] Founding spot count decrements by 1 on the server
- [ ] Re-delivering the same webhook event does **not** decrement again
  (idempotency check)

### 2c  Restore purchases
- [ ] Log out and log back in on the same Apple sandbox account
- [ ] Tap "Restore purchases"
- [ ] `POST /api/iap/sync` is called; `is_squadz_plus` is re-synced from RC
- [ ] Pro status is restored without a new payment

### 2d  Cancellation grace period
- [ ] Cancel the sandbox subscription in App Store sandbox settings
- [ ] RC sends a `CANCELLATION` event
- [ ] Server does **not** revoke `is_squadz_plus` immediately
  (access continues until expiration per `decideEntitlement` in
  `api-server/src/lib/revenuecat.ts`)

---

## 3  Camera and media upload

### 3a  Moment compose (photo)
- [ ] Navigate to Vibe Feed → compose a moment
- [ ] Select a photo from library (iOS photo picker)
- [ ] Confirm upload succeeds and the moment appears in the feed
- [ ] Verify EXIF strip: inspect the uploaded JPEG with an EXIF viewer —
  GPS coordinates should be absent (`ImageManipulator` re-encodes to strip them)

### 3b  Moment compose (video)
- [ ] Select a video from library
- [ ] Confirm the duration cap (>60 s) is enforced with a user-visible alert
- [ ] Upload a ≤60 s video; confirm it posts to the feed
- [ ] Video EXIF: `react-native-compressor` strips container metadata on iOS
  via `AVAssetExportSession` — verify no GPS in the output MP4 using a
  metadata inspector

### 3c  Vault photo upload
- [ ] Open a squad vault → tap Upload
- [ ] Select multiple photos
- [ ] Confirm all upload and appear in the vault grid
- [ ] EXIF is stripped per-asset before the PUT to object storage

### 3d  Camera capture (direct, from chat and feed)
- [ ] In a squad conversation, tap the camera icon
- [ ] iOS prompts for camera permission (first time)
- [ ] Take a photo/video in `launchCameraAsync`
- [ ] Attachment appears in the message composer and sends successfully
- [ ] In the Vibe Feed, tap the camera icon
- [ ] Capture a photo; confirm EXIF is stripped and the moment posts

### 3e  Permission denial flow
- [ ] Deny camera permission at the prompt
- [ ] Confirm a user-visible error message appears (not a silent no-op)
- [ ] Deny photo library permission
- [ ] Confirm the same error handling

---

## 4  Universal links (deep links)

> Universal links require a **signed build** (TestFlight or Ad Hoc) — they do
> **not** work in Expo Go. Also requires `IOS_APP_ID` to be set in secrets so
> the AASA file reflects the real Team ID + bundle ID.

### 4a  AASA file verification
- [ ] `curl -I https://joinsquadz.com/.well-known/apple-app-site-association`
  returns `Content-Type: application/json` (no redirect)
- [ ] Response body contains the correct `appIDs` value
  (`<TEAM_ID>.com.squadz.app`)
- [ ] Validate with Apple's AASA validator:
  https://branch.io/resources/aasa-validator/ or
  https://yurl.ch/

### 4b  Squad public-join link
- [ ] Share a public squad link: `https://joinsquadz.com/squad/join-public?id=<id>`
- [ ] On iPhone with the app installed, tap the link in Messages/Safari
- [ ] App opens directly to the squad join screen (no browser)
- [ ] Confirm the squad name and "Join" button appear

### 4c  Squad invite-code link
- [ ] Share an invite-code link: `https://joinsquadz.com/squad/join?code=<code>`
- [ ] Tap on device; app opens to the invite-code join screen

### 4d  Event invite link
- [ ] Share an event invite: `https://joinsquadz.com/join/<code>`
- [ ] Tap on device; app opens to the event RSVP screen

### 4e  Fallback (app not installed)
- [ ] Tap a squad link on a device **without** the app installed
- [ ] Browser opens `joinsquadz.com`; the Squadz landing page is shown

---

## 5  Ideas feature

### 5a  Full flow
- [ ] Full flow on device: create idea (with link + cost + date) → second account votes →
      threshold nudge notification arrives → confirm → idea appears in the correct day group
      with all details intact
- [ ] Digest notification: add 3 ideas quickly from account B → account A gets ONE notification
- [ ] "Idea confirmed" notification arrives and deep-links to the right tab (event AND trip)
- [ ] Rapid double-tap the vote button repeatedly → count stays correct (race guard, real network)

### 5b  Reorder + merged view
- [ ] Arrow reorder: long-press → arrows appear with haptics; order persists after app restart
- [ ] Undated confirmed idea shows under "Anytime" in the merged trip itinerary view

### 5c  Edge cases
- [ ] Shorten a trip's dates after confirming a dated idea → "outside the trip dates" section
      renders sensibly; re-date the idea via edit sheet and confirm it rejoins the day group
- [ ] Read-only check: on a past/cancelled plan, no add/vote/confirm/reorder affordances appear
      anywhere (Ideas tab, itinerary day groups, event Overview)
- [ ] Block account B from account A → B's ideas and votes are gone from both the Ideas board
      AND the merged itinerary day groups

### 5d  Dual-voting collision (informs stop-vote deprecation decision)
- [ ] On a trip with both a proposed stop and a confirmed idea in the same day: screenshot the
      day group; judge whether two voting affordances (tappable stop vote + frozen idea tally)
      read as confusing

---

## 6  Post-checklist sign-off

All boxes above checked on:

| Item | Tester | Date | Device / iOS version |
|---|---|---|---|
| Push notifications (1a–1g) | | | |
| RevenueCat IAP (2a–2d) | | | |
| Camera / media upload (3a–3e) | | | |
| Universal links (4a–4e) | | | |

Once complete, the build is cleared for App Store submission.
