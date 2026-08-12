# Squadz — multi-user product audit

Scope: the native Expo app (`artifacts/squadz-native`) and the shared API/database
(`artifacts/api-server`), audited as a real collaborative system — many users acting on
shared objects at the same time. The web app (`artifacts/squadz`) was explicitly out of
scope and is not the product surface.

Method: read-only source audit of every multi-user surface, targeted regression tests
against the real route handlers, a 97-test real-Postgres concurrency sweep, and a live
two-account browser pass against the Expo origin.

Result: **5 defects found, 5 fixed.** All suites green — 1,233 API tests, 392 native
tests, 97 real-database concurrency tests, native typecheck clean.

Two of the fixes were reworked after review: the RevenueCat ordering fix (1.5) and the
block enforcement on per-ID feed/moment access (1.3). Both first attempts were
insufficient; §1 describes what actually shipped.

---

## 1. Confirmed defects (all fixed)

### 1.1 Blocking did not remove you from discovery — HIGH

**Affected:** anyone who has blocked, or been blocked by, another user.

Only the profile screen consulted the block table. Every other way to find a person
ignored blocks entirely:

| Surface | Before | After |
|---|---|---|
| `GET /users/search` | blocked users appeared in name search | excluded in SQL |
| `GET /users/by-friend-code/:code` | resolved a blocked user into an add-able profile | 404, neutral copy |
| `GET /users/friends` | a blocked user could remain listed | filtered out |
| `GET /discover` | friend-linked squads/events surfaced blocked users | excluded |

**Reproduction:** A blocks B → B searches A's name → A appears in results with an add
affordance. Tapping through 403s, so the UI dead-ends; the row itself also confirms the
account exists, which is exactly what a block is supposed to deny.

**Why it matters:** blocking is a safety feature. A block that hides someone from one
screen but leaves them searchable by name and resolvable by friend code is not a block.

**Fix:** extracted the both-directions block lookup into `src/lib/blocks.ts` (previously
buried in the moderation router, which discovery surfaces couldn't import without
dragging in its email/storage dependency graph), and applied it to all four surfaces.
Exclusion happens **in the query**, not by post-filtering, so a blocked match can never
consume one of the 20 result slots.

**Deliberate boundary:** bulk `/api/users` hydration is *not* block-filtered. Blocking
leaves shared squad group chat intact by design; filtering there would blank out names
for everyone in the squad. This is asserted as a non-goal in the test file.

**Tests:** `src/__tests__/users.blockDiscovery.test.ts` (9 cases).

### 1.2 Auto-hidden content stayed reachable by ID — HIGH

**Affected:** anyone who reports content; every user who sees reported content.

Auto-hide flips a post/moment to `status = "hidden"` after 3 distinct reporters. The
list queries filtered on it, but the per-ID paths loaded the row directly and checked
only audience. Anyone holding the ID — from a screenshot, a push notification, or their
own earlier scroll — could keep reacting and commenting on reported content, and each
reaction kept generating fresh activity entries and push notifications for the author.

`GET /moments/squad/:squadId` had no hidden filter at all, so reported moments stayed
visible on the squad surface for their full 24h life.

**Fix:** gated inside the two audience helpers (`canViewPost`, `canViewMoment`) so every
per-ID path inherits it at once, plus the missing predicate on the squad moments list.
The **author** is deliberately still allowed through — they must be able to see and
delete their own hidden post.

**Tests:** `src/__tests__/feed.hiddenPerIdAccess.test.ts`, `src/__tests__/moments.squadHidden.test.ts`.

### 1.3 Blocks were not enforced on per-ID feed/moment access — HIGH

`GET /moments/squad/:squadId` didn't filter blocked authors, so a blocked person's
moments still appeared to the person who blocked them — on the one surface where the two
are guaranteed to meet.

Filtering the list queries turned out to be only half the fix. Squad-audience posts and
moments are authorized by **membership**, and blocking deliberately leaves shared squads
intact — so a blocked user holding an ID could still mark a moment viewed and react to
it, pushing a notification straight to the person who blocked them. `canViewMoment`
checked hidden status but never blocks; `canViewPost` had the same gap.

**Fix:** both audience helpers now consult the both-direction block list, so views,
reactions, comments and comment reads inherit it together. Also closed a smaller hole:
`GET /moments/:id/viewers` returned data for a soft-deleted moment (every other per-ID
path already 404s on `deletedAt`).

**Tests:** `src/__tests__/moments.blockedPerIdAccess.test.ts`,
`src/__tests__/feed.hiddenPerIdAccess.test.ts` (block section).

### 1.4 Muting a squad could silently fail — MEDIUM

**Affected:** any user muting a squad on a flaky connection, or after being removed.

`toggleMute()` awaited the `PUT` but only caught *thrown* errors. A `403`, `404`, or
`500` resolves normally, so the switch stayed ON and the user believed the squad was
muted while the server kept sending notifications. Silent failure in a
notification-control surface is the worst place for it: the user only discovers it when
unwanted pushes arrive, and the UI still says "muted".

**Fix:** check `res.ok`, roll back both local and shared state on failure, and surface a
toast. `artifacts/squadz-native/app/squad/[id].tsx`.

**Verified live:** both mute and unmute returned `200` and persisted across sheet
close/reopen in the browser pass.

### 1.5 A late RevenueCat expiration could revoke a paying subscriber — HIGH

**Affected:** any Squadz+ subscriber who renews or resubscribes.

Webhook delivery is neither ordered nor exactly-once, and RevenueCat retries. The
entitlement decision keyed on event *type* alone: a delayed `EXPIRATION` for an old
period, delivered *after* the `RENEWAL` that superseded it, revoked Squadz+ from a user
who was fully paid up. They'd silently lose Pro until the next renewal event or a manual
sync — and being billed while locked out is the kind of bug users escalate.

**Fix (two parts).** Wall-clock alone is not sufficient here, and the first pass got
this wrong: the dangerous event is an `EXPIRATION` for an old period whose timestamp is
*already in the past*, which on the wire is indistinguishable from a genuine lapse.

1. **Period-guarded writes (the real fix).** `users.squadz_plus_period_end_ms` records
   the subscription period that last drove the entitlement flag. The webhook writes
   through `setSquadzPlusForPeriod`, which applies a change only when the event's period
   is **not older** than the one already applied — so the stale `EXPIRATION` arriving
   after its `RENEWAL` is dropped. The comparison is numeric (`::bigint`), because text
   ordering ranks a 13-digit timestamp above a 14-digit one.
2. **Future-dated guard.** An `EXPIRATION` whose own expiry is still in the future has
   plainly been superseded and is ignored regardless.

Events carrying no period still apply unconditionally — there is nothing to order them
by. `/iap/sync` remains an unconditional full-state write (it reads RevenueCat's live
subscriber state, so it is authoritative) but now advances the period marker too,
otherwise the next webhook would compare against a stale period.

`src/lib/revenuecat.ts`, `src/routes/revenuecat.ts`, `src/storage.ts`, `lib/db` schema,
`src/lib/schemaSync.ts`.

**Tests:** `src/__tests__/revenuecat.outOfOrder.test.ts` (decision-level, 6 cases) and
`__tests__/concurrency/multiUserSim.realDb.test.ts` **SIM-11** (6 cases against a real
Postgres — including the exact delayed-old-period-after-renewal scenario, numeric
ranking, and idempotent re-delivery).

---

## 2. Verified working

Confirmed correct by reading the code and exercising it — not assumed.

**Live browser pass, two accounts, Expo origin.** A created a squad; B joined by invite
code; both saw the shared squad and 2 members; B posted to squad chat and it reached A in
~2.5s with no manual refresh; an unrelated third user C was denied the squad detail and
its messages, with no squad content rendered.

**Concurrency (91 real-Postgres tests, 18-user overlapping cohort).** Squad member-list
writes use version CAS with re-read retry, so simultaneous edits don't lose updates.
Event JSON mutations are version-checked and return `409` on conflict; per-user RSVP
writes remain the deliberate atomic per-key exception. Invite/plan-limit claims abort
cleanly under contention.

**Privacy invariants.** 13+ age gate enforced server-side. DMs require a *live*
friendship plus no block, re-checked on create, list, read, send, and stream — a squad
membership is not a friendship. Blocking severs friendship rows and pending requests in
both directions, while leaving squad chat membership-based. Friend requests upsert, so
re-requesting after a decline or unfriend works instead of 500ing.

**Squad chat membership.** Participant rows are append-only and never pruned, so every
access, list, and unread count re-checks *current* membership rather than trusting the
row. A removed member loses access immediately.

**Media and vault.** Personal saves copy the underlying bytes and record provenance
before inserting an independent row with no source FK — so deleting the source photo
doesn't take the saved copy with it. Upload provenance (never a path prefix) is the
ownership check on every media-attaching route.

**Account deletion.** Purges relational rows, embedded event JSON (RSVPs, messages,
tasks, polls, costs — with version bumps), denormalized conversation snapshots, media
bytes collected before the transaction and deleted after commit, and tombstones the auth
subject so a re-login can't resurrect the account.

---

## 3. Accepted behavior — flagged, not changed

**Deleting a cost erases settlement history.** The payer or host can delete a cost at any
time, including after shares are marked paid and confirmed, and the who-paid-whom record
goes with it (it lives only inside the cost object). `PATCH` guards this — editing a cost
with a paid share returns `409` — but `DELETE` is explicitly documented as allowed
regardless of paid state.

I did **not** change this: the asymmetry looks deliberate, and making deletion fail on
paid costs would strand users with an un-removable row after settling in cash. But it
means one tap can erase a group's record of who repaid whom, with no audit trail and no
confirmation naming the consequence. Worth a product decision — see follow-up.

**Non-member denial is a redirect, not a message.** A non-member opening a squad URL is
bounced to onboarding/blank rather than shown an explicit "not available" screen. The
server denies correctly and **no squad content leaks** — this is a UX gap, not a security
one, and it's the same class of issue as the already-queued task about clearer signed-out
messaging.

---

## 4. Limitations

- **Push notification delivery** was verified as far as send logic, preference gating,
  mute filtering, and actor exclusion. Actual APNs/FCM delivery and tap-through routing
  need a physical device.
- **In-app purchases** were verified through the webhook decision logic and its tests.
  The real StoreKit/Play Billing purchase flow requires a device and sandbox accounts.
- **The browser pass used the Expo web build.** Native-only behavior (deep links,
  SecureStore, camera/EXIF, background push) is covered by unit tests and code review,
  not live execution.
- **Load ceiling is unchanged** at roughly 600–800 concurrent users; nothing in this
  audit altered that profile.

---

## 5. Changed files

**Fixes:** `api-server/src/lib/blocks.ts` (new), `routes/users.ts`, `routes/discover.ts`,
`routes/moderation.ts`, `routes/feed.ts`, `routes/moments.ts`, `routes/revenuecat.ts`,
`lib/revenuecat.ts`, `lib/schemaSync.ts`, `storage.ts`, `lib/db` users schema,
`squadz-native/app/squad/[id].tsx`.

**New tests:** `users.blockDiscovery.test.ts`, `discover.blocked.test.ts`,
`moments.squadHidden.test.ts`, `moments.blockedPerIdAccess.test.ts`,
`feed.hiddenPerIdAccess.test.ts`,
`revenuecat.outOfOrder.test.ts`, plus **SIM-11** in
`__tests__/concurrency/multiUserSim.realDb.test.ts` (real Postgres).
