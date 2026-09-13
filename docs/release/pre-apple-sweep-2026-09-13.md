# Pre-Apple release sweep — 2026-09-13

## Recommendation

**NO SUBMIT yet.**

The code gates are green and the confirmed code-level release blockers found in
this sweep are fixed. Submission remains blocked on production/signed-build
evidence that cannot be established from this task branch:

1. The currently deployed AASA response contains
   `TEAMID.com.squadz.app`, and the deployed Android Asset Links response has an
   empty fingerprint list. The checked-in production service configuration has
   real values, but task-branch changes and configuration are not visible on the
   published domain until merged and published.
2. A production iOS RevenueCat public SDK key is not represented in checked-in
   build configuration and could not be verified without reading a secret.
   `lib/revenuecat.ts` intentionally disables purchases when the key is absent.
3. No signed archive, physical iPhone, TestFlight build, Apple push credential,
   StoreKit sandbox purchase, or App Store Connect metadata was available in
   this environment. These checks must not be inferred from Expo Go or source.

Submit only after the physical-device checklist below passes on the exact signed
candidate and the published AASA response contains
`2567CLAZKC.com.squadz.app`.

## Release baseline and targeted areas

Recent merged work touched vault video upload/quality, invite-code copy and
manual joins, profile settings, universal-link recovery, landing analytics,
trip utilities, and RevenueCat. The sweep gave those areas targeted review in
addition to the full launch matrix: authentication/session recovery, account
switching, friends/blocking, squads, plans/invites, availability, chat, costs,
media, feed/moments, notifications, profile/privacy, deletion, and entitlement
ordering.

## Automated verification

| Gate | Result |
| --- | --- |
| Root/shared and all artifact typechecks | PASS |
| API unit/integration suite | PASS — 146 files, 1,461 tests |
| API real-DB concurrency suite | PASS — 4 files, 99 tests |
| Mobile unit suite | PASS — 60 files, 711 tests |
| Shared cost-math suite | PASS — 1 file, 44 tests |
| API production build | PASS |
| Web client/SSR/prerender production build | PASS |
| Mockup production build | PASS with required `PORT`/`BASE_PATH` build env |
| Mobile static production bundle | PASS — iOS and Android bundles, 54 assets |
| Expo dependency compatibility | PASS — `expo install --check` |
| Expo Doctor | PASS — 18/18 checks |
| Static Expo config resolution | PASS — `expo config --type public` |
| Diff whitespace validation | PASS |

The root build command still requires artifact build environment variables
(`PORT`, `BASE_PATH`) supplied by managed builds. Each affected production build
was run directly with those variables and passed.

## Confirmed defects fixed

### Availability poll scope escalation — HIGH

A caller authorized for an event could create a poll carrying an unrelated
squad ID; later authorization preferred the squad and exposed the poll to that
squad. Creation now rejects conflicting scopes, storage enforces the invariant,
and legacy mismatched records fail closed. Regression coverage proves unrelated
squad members cannot read or respond.

### Bulk profile privacy bypass — HIGH

The bulk user endpoint returned names and avatars without applying block/private
profile policy. Bulk lookup now filters both-direction blocks and unauthorized
private profiles while preserving self, friend, shared-squad, and public
visibility. Focused tests cover each case.

### Expo Launch dynamic configuration — RELEASE BLOCKER

Required release settings lived only in `app.config.js`, which Replit Expo
Launch does not support. The app now uses static `app.json` for encryption,
updates URL, runtime policy, and Expo project identity. Native API resolution
cannot fall through to an empty relative URL and defaults safely to
`https://joinsquadz.com` outside development.

### Account deletion invite remnants — MEDIUM

Deletion now transactionally removes event and squad invites involving the
deleted account and invites tied to hosted events/deleted squads. Regression
coverage verifies those rows do not survive.

### Schema sync health false positive — HIGH

Startup previously continued after schema sync failure, allowing a broken
database to pass the liveness probe. Schema sync now logs and rethrows, so the
server cannot listen/report healthy with a partially synchronized schema.

### Mobile production build port collision — BUILD BLOCKER

The static bundle script hardcoded Metro port 8081 and failed while the mockup
workflow occupied that port. The script now accepts `METRO_PORT`, passes it to
Expo, and uses it for every Metro request. A full build passed on port 8082.

### Expo patch-level drift and privacy manifest drift — HIGH

Expo packages were aligned to SDK 54 expected versions. The app-owned privacy
manifest now includes identifiers, other user content, product interaction,
purchase history, and performance diagnostics in addition to existing
name/email/media/crash declarations. Tracking remains disabled.

## Runtime and production-boundary checks

- API workflow restarted cleanly after changes.
- Startup schema sync completed before listen.
- Stripe schema migration/backfill and managed webhook setup completed.
- SMTP was configured, PostgreSQL pub/sub connected, and push receipt,
  engagement, retry, media-backup, account-cleanup, and pool-monitor jobs were
  scheduled.
- Production `/api/healthz` returned 200.
- An unauthenticated production `/api/squads` request returned 401.
- Production landing, privacy, terms, support, squad join, and event invite
  fallback URLs returned 200.
- Production AASA and Asset Links URLs returned JSON/200, but their identity
  contents are stale placeholders as described in the no-submit blockers.
- Web landing rendered successfully with no application console errors.
- Expo web started and bundled successfully. The automated snapshot remained on
  the app's short black splash gate; unauthenticated API 401s were expected.
  This is not physical-device evidence.

## Authorization and collaborative coverage

The passing API suites cover authentication and refresh classification,
friend/block lifecycle and canonical pair locking, live squad membership,
host/co-admin plan mutations, invite acceptance/routing contracts,
availability access/nudges/SSE, current-membership chat access, version-guarded
costs and polls, protected storage audiences, vault/feed/moment visibility,
profile privacy, account purge/tombstones, notification preferences and fan-out,
RevenueCat webhook ordering, founding claims, scheduler locks, and retry
behavior. The real-DB concurrency suite additionally proves one-winner versioned
mutations, cap ledgers, founding-spot atomicity, poll conversion exactly once,
squad membership CAS behavior, and one plan-chat thread under concurrency.

## Remaining risks and disposition

### Must close before submission

- Publish the merged candidate and verify AASA uses the real Apple team ID.
- Verify the signed build contains the Associated Domains and Push
  Notifications entitlements.
- Verify the production build receives the RevenueCat iOS public SDK key and the
  live `squadz_plus` entitlement/products.
- Complete the exact-build physical iPhone/TestFlight checklist below.
- Reconcile the App Store Connect privacy nutrition label with the checked-in
  manifest and privacy policy.
- Confirm App Store Connect version/build number, screenshots, description, age
  rating, support URL, review credentials, and subscription metadata.

### Follow-up engineering risks

- Signed direct uploads validate client-declared MIME/size before issuing a URL,
  but enforcement at the object provider boundary is not proven in source.
  Confirm bucket/provider policy or add post-upload/server-side enforcement.
- Webhook email dedup marks an email before transport succeeds; a transport
  outage can suppress a retry. Stripe linkage side effects also continue
  best-effort after some transient parsing/lookup failures.
- Account media cleanup stops automatic retries after eight attempts and raises
  an operational alert; durable manual cleanup ownership remains required.

## Physical iPhone/TestFlight checklist

Run on the exact signed submission candidate:

- Fresh signup, 13+ gate, onboarding completion, relaunch, and returning login.
- Expired access token refresh, offline recovery, force-kill recovery, logout,
  and account switching without cross-account cached data.
- Friend request/accept/remove/block; private-profile and blocked-user checks.
- Create/join/leave squad; create/edit/cancel event and trip; direct, squad, and
  universal-link invites while cold, warm, logged out, and session-expired.
- Availability create/respond/nudge/live refresh and trip best-stretch flow.
- Direct/squad/event/trip chat, unread state, keyboard/safe-area behavior, and
  notification taps to openable destinations.
- Costs, receipt capture/upload, exact splits, payment handles, and permissions.
- Camera/library photo and video upload, protected playback, vault save/delete,
  feed/moments reactions/comments, and denied-permission recovery.
- Push permission/register/delivery, preference gating, mute behavior, cold tap,
  stale-token handling, and duplicate suppression.
- RevenueCat founding/standard product display, sandbox purchase, cancellation,
  restore after reinstall/account switch, expiry/revocation, webhook lag, and
  entitlement precedence. Do not perform a real-money purchase.
- Account deletion followed by attempted re-login and verification that private
  media/invites are no longer reachable.
