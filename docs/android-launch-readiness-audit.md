# SquadZ Android Launch Readiness Audit

**Audit date:** September 21, 2026  
**Mode:** Read-only repository audit  
**Scope:** Android purchase wiring, RevenueCat setup, privacy disclosures, Android permissions, Play build freshness, and signing fingerprint/app links.

## Executive summary

| Area | Status | Launch impact |
|---|---|---|
| 1. Android SKU handling and founding redemption | **confirmed current** at source/test level; live transaction **stale or unverified** | Code handles Play subscription/base-plan identifiers and atomically accounts for founding redemptions. A real Play purchase still must prove the end-to-end path. |
| 2. RevenueCat Android and service-account setup | **stale or unverified** | Repository contracts are defined, but RevenueCat/Play dashboard state, credentials, grants, products, offering, and webhook delivery are not proven by repository evidence. |
| 3. Privacy-policy coverage | **stale or unverified** | The public policy exists and is linked in-app, but it does not fully describe current profile, contact, media, purchase, telemetry, and metadata collection. Update before Play Data Safety submission. |
| 4. Android permissions and Data Safety | **stale or unverified** | Source justifies core camera/media/notification permissions, but the exact release merged manifest is unavailable and `ACCESS_MEDIA_LOCATION` lacks a clear disclosed product need. |
| 5. Play build and version freshness | **stale or unverified** | Source says app `1.0.0`, local Android `versionCode` 7, while production EAS uses remote auto-increment. Neither the remote version nor Play-uploaded build is known. |
| 6. Android SHA-256 signing fingerprint | **not started** in repository evidence | The server expects a deploy-time real fingerprint, but none is checked in and the documented production verification record remains pending. Verified Android app links cannot be claimed. |

The repository was not modified except for this report. No environment values were read, no dashboards or production database were queried, and no build, submission, deployment, purchase, or physical-device test was performed.

---

## 1. Android SKU handling and founding redemption

**Status: confirmed current** for code and automated coverage.  
**Live Google Play transaction evidence: stale or unverified.**

### Repository-confirmed

- The Android founding and standard products are explicitly defined as:
  - `squadz_plus_founding_yearly:founding-yearly`
  - `squadz_plus_standard_yearly:standard-yearly`
  in `artifacts/squadz-native/lib/revenuecat.ts:9-18` and `artifacts/api-server/src/lib/revenuecat.ts:11-21`.
- Native selection is platform-specific. On Android, the app chooses the Android product/base-plan identifier and compares the base subscription ID before the first `:`. This prevents a Play identifier from failing an iOS-style exact comparison: `artifacts/squadz-native/lib/revenuecat.ts:23-50,151-168,322-359`.
- The paywall only displays the founding tier when the server reports capacity and RevenueCat supplies a live founding package price. It rechecks capacity immediately before package selection: `artifacts/squadz-native/components/UpgradeModal.tsx:140-205,343-370` and `artifacts/squadz-native/lib/revenuecat.ts:294-359`.
- The API normalizes Play `subscriptionId:basePlanId` identifiers, maps current and legacy Android forms to founding/standard, and recognizes events that omit entitlement IDs but include a known product: `artifacts/api-server/src/lib/revenuecat.ts:27-96`.
- A founding redemption requires a founding product, a paid `NORMAL` period, and a purchase/renewal event. The ledger key is derived from the original transaction ID and prefixed `rc:` for idempotency: `artifacts/api-server/src/lib/revenuecat.ts:148-177`.
- The webhook claims the founding ledger before writing founding provenance. Missing users or transaction IDs and redemption failures return an error so RevenueCat retries. A purchase arriving after sellout retains access but is recorded as standard: `artifacts/api-server/src/routes/revenuecat.ts:167-230,232-290`.
- Automated tests cover Android product/base-plan mapping, package selection, webhook redemption, tier assignment, and duplicate/idempotent processing:
  - `artifacts/squadz-native/lib/__tests__/revenuecat.test.ts`
  - `artifacts/squadz-native/lib/__tests__/revenuecatTierMapping.test.ts`
  - `artifacts/api-server/src/__tests__/revenuecat.productMapping.test.ts`
  - `artifacts/api-server/src/__tests__/revenuecat.webhook.test.ts`
  - `artifacts/api-server/src/__tests__/revenuecat.outOfOrder.test.ts`

### Not proven

Synthetic tests and mocked webhook receipts are not evidence of a live Google Play transaction. No checked-in receipt, sanitized production audit record, Play order evidence, or production database result proves that an actual Play purchase:

1. returned the founding entitlement on an Android device;
2. delivered the RevenueCat webhook;
3. wrote the user's tier as `founding`; and
4. incremented the durable founding-redemption ledger exactly once.

### Next manual verification

Run one licensed tester purchase of the founding base plan on a signed Play-track build. Record the Play order and RevenueCat event IDs outside source control, then verify read-only production results for the subscriber tier and one corresponding `rc:` founding ledger entry. Repeat with restore and confirm no second ledger consumption.

---

## 2. RevenueCat Android and Google Play service account

**Status: stale or unverified.**

### Repository-confirmed configuration contract

- Native Android requires `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`; configuration identifies the RevenueCat subscriber with the SquadZ user ID: `artifacts/squadz-native/lib/revenuecat.ts:69-116` and `artifacts/squadz-native/app/_layout.tsx:420-485`.
- Server-side subscriber reconciliation requires `REVENUECAT_API_KEY`: `artifacts/api-server/src/routes/revenuecat.ts:63-128`.
- The webhook requires an exact `Authorization` value matching `REVENUECAT_WEBHOOK_AUTH`; unset configuration returns 503 and mismatch returns 401: `artifacts/api-server/src/routes/revenuecat.ts:135-159`.
- Expected catalog identifiers are centralized in client, server, and the idempotent seeding script. The script expects:
  - Android founding and standard products/base plans listed in area 1;
  - entitlement `squadz_plus`;
  - offering `default`;
  - founding and annual packages.
  See `scripts/src/seedRevenueCat.ts:1-29,115-150,181-207`.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` is consumed by `artifacts/api-server/src/lib/playBilling.ts`. The server parses the service-account identity/key, obtains an Android Publisher OAuth token, and can cancel a Play subscription during account deletion. This service account is not the normal entitlement-sync mechanism; RevenueCat REST and webhook state remain the subscription source of truth.
- The expected production webhook URL is documented as `https://joinsquadz.com/api/revenuecat/webhook`: `docs/pre-launch-device-checklist.md:21-27`.

### External facts not proven

Repository evidence cannot confirm that:

- the Android public SDK key is populated in the EAS production environment;
- `REVENUECAT_API_KEY` and webhook authorization match the active RevenueCat project;
- RevenueCat contains Android app `com.squadz.app`;
- both Play subscriptions and base plans are active and attached to the current offering;
- entitlement `squadz_plus` is attached to all intended products;
- RevenueCat's Google Play service-account integration is connected and healthy;
- the server's Google Play service account has the required Play Console/API permissions;
- the production webhook is enabled, points to the deployed route, and has delivered successfully;
- package availability and localized prices resolve on a signed Android build.

The presence of secret names in the environment inventory is not proof that values are valid or connected. This audit did not inspect secret values.

### Next manual verification

In RevenueCat, verify the Android app/package, Play credentials health, products/base plans, entitlement, current offering/packages, and recent production webhook deliveries. In Play Console, verify the linked API/service account and its subscription-management permissions. Then validate package loading and subscriber identification on a licensed tester build.

---

## 3. Privacy-policy coverage versus current collection

**Status: stale or unverified.**

### Policy surfaces

- The canonical policy is the marketing-site route at `https://joinsquadz.com/privacy`, implemented in `artifacts/squadz/src/pages/Privacy.tsx`.
- The native privacy/settings screen links out to that web policy; it does not contain a separate full native policy: `artifacts/squadz-native/app/settings/privacy.tsx:115-118,172-187`.
- The purchase sheet also links to the same policy: `artifacts/squadz-native/components/UpgradeModal.tsx:67-73`.
- The source policy says it applies to both the mobile app and website and is dated June 10, 2026: `artifacts/squadz/src/pages/Privacy.tsx:50-75`.

### Covered adequately at a high level

The policy covers name, email, bio, hometown, avatar, squads/social activity, uploaded photos, messages, cost-split records/payment handles, device/app information, push tokens, analytics, crash reporting, service providers, notifications, retention, and deletion rights: `artifacts/squadz/src/pages/Privacy.tsx:65-124`.

### Current collection that is missing or under-described

- **Age/birth data:** the app collects a birthdate in profile editing and the server stores age-gate/birth-year related state. The policy only states that the service is not directed to children under 13; it does not say that birthdate, birth year, or age eligibility is collected or how it is displayed/retained: `artifacts/squadz-native/app/settings/edit-profile.tsx:70-75,159-190,316-355`.
- **Hobbies:** up to five hobbies are collected and displayed as profile data but are not named in the policy: `artifacts/squadz-native/app/settings/edit-profile.tsx:74-75,186-190,357-391`.
- **Phone number/contact matching:** the user schema and matching routes support phone-based identity/contact matching, but the policy does not disclose phone-number collection, normalization/matching, contact discovery, or whether an address book is uploaded. Repository runtime searches did not find native `expo-contacts` access, so full address-book collection must not be claimed without device evidence. Relevant server surfaces include `artifacts/api-server/src/routes/users.ts` and `artifacts/api-server/src/routes/userPreferences.ts`.
- **City/hometown and bio:** both are named only within a broad “optional profile details” bullet. The policy does not explain profile audience rules, including private-profile/friend/shared-squad visibility, although those fields are actively collected: `artifacts/squadz-native/app/settings/edit-profile.tsx:290-315`.
- **Media scope:** the policy says images selected for squad vaults. Current features also use profile avatars, feed/moment media, chat attachments, event-cost receipts, videos, camera capture, personal vault copies, and downloads. The existing wording is narrower than actual use.
- **Location metadata:** Expo media-library configuration enables media-location access, while image upload code strips EXIF/GPS metadata. The policy does not explain either behavior: `artifacts/squadz-native/app.json:87-92` and `artifacts/squadz-native/app/settings/edit-profile.tsx:134-153`.
- **Purchases and identifiers:** RevenueCat/Play purchase history, subscription identifiers, entitlement state, and provider processing are not described with the same specificity as current implementation.
- **Telemetry:** Sentry/PostHog are named, but linked identifiers, event categories, crash/performance data, retention, and sharing purposes are not sufficiently detailed to directly map to Play Data Safety declarations.
- **Account deletion wording:** the policy says users may request deletion by email, while the native app contains an in-product delete-account flow: `artifacts/squadz-native/app/settings/privacy.tsx:189-276`.

### Launch impact

The policy is not current enough to use as the sole support for Play Data Safety answers. In particular, phone/contact matching, birth/age data, hobbies, broader media usage, purchase history, linked analytics/device identifiers, and media-location metadata need explicit review.

### Next manual verification

Create a data inventory from the production schema, API routes, SDK configurations, and actual release merged manifest. Update the canonical policy and effective date, then complete Play Data Safety from that same inventory. Confirm whether contact matching uses only a user-entered phone number or reads device contacts; the declarations differ materially.

---

## 4. Android permissions and Play Data Safety justification

**Status: stale or unverified.**

Expo config introspection was run successfully from `artifacts/squadz-native` with:

```sh
pnpm exec expo config --type introspect --json
```

The resulting generated configuration is stronger evidence than dependency inference. It is still not the final release AAB manifest: Android library manifests can add permissions during Gradle merging, and build-profile differences can remove or add entries.

### Complete Expo-introspected permission inventory

| Config-generated permission | Current runtime/product use found | Play/privacy assessment and required action |
|---|---|---|
| `android.permission.INTERNET` | Required for API calls, uploads, RevenueCat, Expo, Sentry, and PostHog. | **Justified.** Not itself a Data Safety data type, but every transmitted category/provider must be declared. |
| `android.permission.SYSTEM_ALERT_WINDOW` | No production product feature was found. This is commonly associated with development tooling. | **Not justified for a Play release.** Confirm it is absent from the production AAB; if present, remove its source before submission. It does not create a Data Safety category, but it is a high-trust capability. |
| `android.permission.VIBRATE` | Used for notifications and haptic feedback. | **Justified.** No separate collected-data category. |
| `android.permission.READ_EXTERNAL_STORAGE` | Legacy media-library/image-picker compatibility; app selects and saves user media. | **Potentially justified only on legacy Android versions.** Confirm `maxSdkVersion` in the final manifest and limit/remove broad access where Android Photo Picker/scoped storage is sufficient. Policy must describe selected media. |
| `android.permission.WRITE_EXTERNAL_STORAGE` | Legacy save-to-library compatibility. | **Potentially justified only on legacy Android versions.** Confirm `maxSdkVersion`; remove unrestricted legacy write access if not required. |
| `android.permission.READ_MEDIA_VISUAL_USER_SELECTED` | Android selected-photo access for avatar, vault, moments, feed, chat, and receipt media. | **Justified.** Prefer this limited access over broad library access. Declare photos/videos collected for app functionality when uploaded. |
| `android.permission.ACCESS_MEDIA_LOCATION` | Explicitly enabled by `isAccessMediaLocationEnabled: true` in `artifacts/squadz-native/app.json:87-92`; no runtime feature that reads photo location metadata was found. Upload paths strip EXIF/GPS. | **Not currently justified.** Disable unless a documented feature requires it. If retained and metadata is accessed or transmitted, disclose location/photo metadata and answer Data Safety accordingly. |
| `android.permission.READ_MEDIA_IMAGES` | Media selection and save flows use images across profiles, vault, feed/moments, chat, and cost receipts. | **Functionally related but broader than selected-media access.** Confirm why broad image access is needed instead of Photo Picker; disclose uploaded images. |
| `android.permission.READ_MEDIA_VIDEO` | Video selection/upload is supported in media surfaces. | **Functionally related but broader than selected-media access.** Confirm broad access is needed; disclose uploaded videos. |
| `android.permission.READ_MEDIA_AUDIO` | No standalone audio-library selection, upload, or playback-import feature was found. | **Not justified by current runtime use.** Remove its plugin/dependency source before Play submission unless a real audio feature is identified. If used, declare audio files collected. |
| `android.permission.READ_CONTACTS` | `expo-contacts` is installed, but no Contacts API call or runtime contacts permission request was found. Current invite sharing opens platform sharing/SMS surfaces. | **Not justified by current runtime use and privacy-sensitive.** Remove unless device contact matching is intentionally implemented. If retained/used, policy and Data Safety must explicitly disclose contacts collection, processing, sharing, retention, and optionality. |
| `android.permission.WRITE_CONTACTS` | No feature that creates or modifies device contacts was found. | **Not justified.** Remove before Play submission. Contact matching does not justify writing the address book. |
| `android.permission.RECORD_AUDIO` | No microphone permission request or audio-recording feature was found. The iOS microphone usage string alone does not establish Android runtime use. | **Not justified by current runtime use.** Remove unless video capture genuinely records audio and the permission is required; if retained, add an in-context explanation and disclose collected audio. |
| `android.permission.ACCESS_COARSE_LOCATION` | `expo-location` is installed, but no device-location request, current-position read, or watcher was found. Event locations are user-entered text. | **Not justified and privacy-sensitive.** Remove unless a location feature is intentionally shipped. If used, disclose approximate location and purpose. |
| `android.permission.ACCESS_FINE_LOCATION` | No device-location runtime use was found. | **Not justified and privacy-sensitive.** Remove unless a precise-location feature is intentionally shipped. If used, disclose precise location, foreground/background behavior, and purpose. |

The sensitive overbreadth is a launch blocker even if Android never displays a prompt: the generated configuration currently declares contacts, precise/approximate location, microphone, broad media/audio, media-location metadata, legacy storage, and overlay access without corresponding runtime use identified by this audit.

### Runtime-requested or likely dependency-merged permissions not emitted in the config list

These must be checked separately in the production AAB's final merged manifest:

- `android.permission.CAMERA`: the app calls `ImagePicker.requestCameraPermissionsAsync()` for feed and chat capture. Camera use is justified, but the policy currently describes only photo-library selection and should include camera-created media.
- `android.permission.POST_NOTIFICATIONS` on Android 13+: the app requests notification permission and registers an Expo push token in `artifacts/squadz-native/app/_layout.tsx:148-273`. The feature is justified; the policy should specify linked device identifiers/provider processing.
- Notification receiver/scheduling capabilities such as `RECEIVE_BOOT_COMPLETED`: Expo Notifications may contribute these through its Android library manifest.
- Any foreground-service, billing, advertising-ID, install-referrer, or SDK-added permission: none should be assumed absent until the exact production AAB manifest is inspected.
- SMS permissions were not emitted by introspection. Opening the system SMS composer does not by itself establish SMS/contact collection or justify a dangerous SMS permission.

### Data Safety implications

Permissions and Data Safety are related but not equivalent. At minimum, review declarations for account identity, phone number, age/birth data, user-generated text, photos/videos, messages, contacts only if actually accessed, approximate/precise location only if actually collected, purchases, app interactions, device identifiers/push tokens, crash data, and performance data. For each, document whether it is collected, shared, ephemeral, required/optional, linked to identity, encrypted in transit, and deletable.

### Next manual verification

First remove or explicitly justify the config-generated permissions with no runtime use. Then build or inspect the exact production artifact without uploading it, export the merged manifest (`bundletool`, `apkanalyzer`, or Android Studio APK Analyzer), and reconcile every final permission with a live feature and the policy/Data Safety worksheet. Test prompts and denied-permission behavior on physical Android devices across supported OS versions.

---

## 5. Current Play build and version freshness

**Status: stale or unverified.**

### Repository-confirmed

- Marketing app version: `1.0.0`: `artifacts/squadz-native/app.json:3-6`.
- Locally configured Android `versionCode`: **7**: `artifacts/squadz-native/app.json:27-30`.
- EAS uses `"appVersionSource": "remote"` and production Android `"autoIncrement": true`: `artifacts/squadz-native/eas.json:2-5,27-39`.
- Therefore, `versionCode: 7` is a local baseline, not authoritative evidence of the next or latest production build number. A production EAS build can use and increment the remote value without rewriting this file.
- Repository history shows substantial mobile changes after the earlier profile/contact/notification work, including RevenueCat, deep links/invites, media, onboarding, notification routing, and plan-detail changes. Source history proves code changed; it does not prove those commits are inside any Play binary.

### External facts not proven

This audit cannot identify:

- the current EAS remote Android version code;
- the latest successful production Android build ID, commit SHA, or channel provenance;
- the version code currently uploaded to Play Console;
- the version promoted to internal, closed, open, or production tracks;
- whether the uploaded binary includes profile fields, phone/contact matching, notification fixes, SKU normalization, privacy changes, or later merged work.

No new version bump should be inferred solely from local `versionCode: 7`; with remote auto-increment, build provenance is the deciding evidence.

### Launch impact

Manual Play declarations and transaction/device verification are only meaningful when tied to a specific signed AAB and commit. The current uploaded binary may predate launch-critical source changes.

### Next manual verification

Read EAS production build history and Play Console App Bundle Explorer side by side. Record the latest build's version code, app version, build ID, git commit, creation date, signing certificate, and Play track. Compare that commit against the required launch-change checklist. If it predates required changes, create a separately approved build task; this audit does not build or upload one.

---

## 6. Android SHA-256 signing fingerprint and app links

**Status: not started** based on repository evidence.

### Repository-confirmed

- Android package/application ID is `com.squadz.app`: `artifacts/squadz-native/app.json:27-29`.
- Android intent filters use `autoVerify: true` for `https://joinsquadz.com` invite/friend paths: `artifacts/squadz-native/app.json:34-72`.
- The server's Digital Asset Links response reads real fingerprints from deploy-time `ANDROID_SHA256_CERT_FINGERPRINTS`. In production it returns 503 when the package or fingerprint is missing/malformed: `artifacts/api-server/src/routes/wellKnown.ts:17-24,31-54,113-133`.
- No real SHA-256 fingerprint is checked into app or server configuration. This is appropriate for deploy-time identity, but it means repository evidence cannot confirm setup.
- The deep-link smoke test requires at least one well-formed fingerprint but explicitly cannot prove that it matches a signed build or that a physical device opens the app: `scripts/src/smoke-test-deeplinks.ts:12-27,146-224,259-273`.
- The project launch checklist still records production app-link identity/device verification as pending: `replit.md:118-137` and `docs/pre-launch-device-checklist.md:21-27`.

### Fingerprint source that must be distinguished

For Play-distributed builds, use the **Play App Signing certificate SHA-256** from Play Console → App integrity, not merely the upload certificate. If an internally distributed EAS build is also expected to verify app links, its signing certificate may need an additional fingerprint in the comma-separated list.

### Launch impact

Until production `assetlinks.json` contains the actual signing fingerprint(s), Android `autoVerify` cannot reliably associate `joinsquadz.com` with the installed app. Links may open in the browser or chooser instead of SquadZ.

### Next manual verification

1. Retrieve the Play App Signing SHA-256 fingerprint and any intentionally supported non-Play signing fingerprint.
2. Set the production deployment value for `ANDROID_SHA256_CERT_FINGERPRINTS`.
3. Confirm `https://joinsquadz.com/.well-known/assetlinks.json` returns the correct package and fingerprints over HTTPS with no redirect.
4. Run the repository smoke test against production.
5. Install the signed Play-track build on a physical Android device, run `adb shell pm verify-app-links --re-verify com.squadz.app`, confirm `pm get-app-links` reports `verified`, and tap each supported invite/friend URL.

---

## Launch decision

**Repository code is ready for an Android licensed-tester purchase attempt, but Android launch readiness is not yet demonstrated.**

The source-level SKU/founding path is current and tested. The remaining launch evidence is external and material: RevenueCat/Play catalog and credentials, one real Play purchase with durable founding accounting, an updated privacy/Data Safety inventory, the release merged manifest, EAS/Play build provenance, the Play signing fingerprint in production Asset Links, and signed physical-device verification.