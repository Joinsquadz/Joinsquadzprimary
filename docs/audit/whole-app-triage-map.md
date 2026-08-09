# SquadZ — Whole-App Feature & Process Audit (Triage Map + Decision List)

**Report only. No code was changed. Cost splitting (#583) was not touched.**

## Evidence legend

Every claim below carries one of these labels. Nothing is presented as confirmed
that was not actually confirmed.

| Label | Meaning |
| --- | --- |
| `[CODE]` | Read the implementation directly this pass. High confidence about what the code does. |
| `[DB]` | Verified against the live development database with a read-only query. |
| `[TEST-EXISTS]` | An automated test file covering this exists in the repo. **The suites were not executed in this pass** — existence of a test is not proof it currently passes. |
| `[INFER]` | Reasoned conclusion, not directly observed. Treat as a hypothesis a deep-dive should confirm. |

Scope note: the map covers `artifacts/api-server` (shared backend) and
`artifacts/squadz-native` (the product). `artifacts/squadz` is the marketing
landing page and is out of scope.

---

## Stage 1 — The triage map

`WC` = write-concurrency risk. `DD` = deep-dive recommended.

### Squads & membership

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| Squad create | Creates squad, creator as sole member | **Low — guarded**: free-squad cap + insert in one advisory-lock transaction `[CODE]` `routes/squads.ts:405-436` | One push fan-out to all selected invitees `[CODE]` `:492-516` | — | No |
| Squad join (public + invite code) | Appends joiner to `member_ids` | **Low — guarded**: atomic JSON append with `NOT @>` guard + version bump inside advisory lock `[CODE]` `:149-163`, `:268-282` `[TEST-EXISTS]` `squads.atomicJoin.test.ts`, `squads.w03.joinVersion.test.ts` | Reads all member IDs, filters tokens, fans out one notification per member `[CODE]` `:196-218`, `:305-326`; `member_ids` grows unbounded | Two join mechanisms (public ID join vs code join) with separate links | No |
| Squad PATCH (settings, member removal, reorder) | Edits metadata; removals/reorder applied, additions converted to pending invites | **Medium — conditionally guarded**: version predicate applied *only when the client sends one* `[CODE]` `:701-712` | Rewrites the entire `member_ids` JSON array `[CODE]` `:703-711` | Adds silently become invites while removals apply immediately; reorder is allowed and mutates ownership succession | Yes |
| **Squad leave / remove member / ownership transfer** | Removes a member, deletes last-member squads, transfers creator | **HIGH — UNGUARDED** `[CODE]` `:1178`, `:1205-1209`: read-modify-write of `member_ids` with `WHERE id` only, **no version predicate and no version bump** | Full-array rewrite per removal; no paginated member list | Ownership succession depends on array order, which PATCH can reorder | **Yes** |
| Co-admin add/remove | Role management | Low — version bumped `[CODE]` `:1422`, `:1472` | O(n) role checks | Creator vs co-admin permissions differ per endpoint | No |
| Squad pending invites | Invite rows requiring acceptance | Medium — PATCH path upserts `[CODE]` `:744-766`; standalone invite is check-then-insert `[CODE]` `:1070-1097` | Loops activity rows + pushes per invitee `[CODE]` `:474-483` | Squad invites are relational rows; event invites are a JSON array — divergent models | No |
| Member cap | — | No server-enforced squad member cap exists `[CODE]` (only a per-user free-squad count) | Member list renders every member, unvirtualized `[CODE]` `app/squad/[id].tsx:584-595` | Product expectation vs enforcement may diverge | No |

### Plans, events & trips

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| Event create / edit / delete | Shared `events` row | Medium — edit uses proper CAS (`WHERE id AND version`, 409) `[CODE]` `routes/events.ts:835-855` | — | — | No |
| RSVP | Per-user attendance | Low — deliberately not CAS'd, uses atomic JSONB key merge + version bump `[CODE]` `:1119-1129` `[TEST-EXISTS]` `events.pastEventRsvp.test.ts` | One host push per RSVP — 50 RSVPs = 50 pushes to one host `[CODE]` `:1159-1179` | — | No |
| Event personal invites | `invited_user_ids` array | Medium — version bumped but keyed on id only `[CODE]` `:1234-1246` | Per-target `userCanAccessEvent` call — N+1 `[CODE]` `:1203-1210` | — | No |
| Event tasks | Add/toggle/claim | Medium — **version predicate is optional server-side** `[CODE]` `:1353-1358`, `:1383-1389`; shipped client always sends it `[CODE]` `context/AppContext.tsx:1891`, `:1932`, `:1976` | Full task array copied and full event returned per mutation `[CODE]` `:1349-1364` | — | No |
| **Event chat (JSON array)** | Messages appended to a JSON column on the event row | Medium — optional version predicate `[CODE]` `:1962-1968` | **Unbounded array, fully copied and fully returned on every send** `[CODE]` `:1958-1973`; no cap/trim found `[CODE]`; SSE to all watchers `[CODE]` `:1977-1980` | A second, entirely separate chat system exists (paginated `conversations` tables) with different semantics | **Yes** |
| Itinerary stops + voting/confirm | Ordered JSON array | **Low — well guarded**: all five ops require version, CAS, 409 `[CODE]` `:2142-2149`, `:2179-2186`, `:2216-2225`, `:2259-2266`, `:2295-2302` | Whole trip shares one version → legitimate 409 storms under concurrent voting `[INFER]` | Two ordering systems (stops + confirmed ideas) merged in one view | No |
| Ideas (suggest/vote/confirm/reorder/pin) | Normalized `plan_ideas` / `idea_votes` | Medium — votes atomic + unique `[CODE]` `routes/ideas.ts:702-716`; deletes transactional `[CODE]` `:672-676`; **edit/status/reorder/pin have no version guard** `[CODE]` `:635-639`, `:770-774`, `:803-807` | Loads all ideas + votes + submitters unpaginated `[CODE]` `:454-486`; reorder is N updates `[CODE]` `:559-566` | Ideas surface as itinerary but are not protected by `events.version` | No |
| Packing lists | JSON array | **Low — well guarded**: mandatory version CAS on all ops `[CODE]` `:2331-2341`, `:2367-2375`, `:2403-2414` | Full-array rewrite per op | — | No |
| **Cost splitting** | — | **ALREADY AUDITED (#583) — excluded from this pass, not inspected, not touched** | — | — | Done |

### Availability polling

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| Create poll | Poll row with JSON days/slots | Medium — find-then-create with no unique scope constraint `[CODE]` `routes/availability.ts:322-343` | Roster bulk-load O(n) `[CODE]` `:45-50`; ad-hoc invitees capped at 50 `[CODE]` `:118`; poll list unpaginated `[CODE]` `:402-424` | `reuse` vs `forceNew` vs `adhoc` flags are spread across several booleans | No |
| Respond (cell upsert) | Replaces one user's cells | **Low — guarded** by unique `(poll,user)` upsert `[CODE]` `storage.ts:980-987` `[TEST-EXISTS]` `availability.respondedAt.test.ts` | Up to 1,488 cell strings per user; full response set + heatmap + every member's cells returned after every write `[CODE]` `:897-912`, `:230-235` | Out-of-grid cells silently dropped, surfaced only as `droppedCount` `[CODE]` `:888-895` | **Yes** |
| Update poll range | Host edits date range | Medium — full response scan + one UPDATE per affected response (N+1) `[CODE]` `storage.ts:878-903` | Push fan-out to all pending participants `[CODE]` `:681-734` | "Needs update" state depends on preserved timestamps | No |
| **Nudges** | Creator nudges a pending member | **HIGH — broken invariant**: route implements a 5-minute debounce then plain-INSERTs `[CODE]` `routes/availability.ts:810-823`, `storage.ts:1038-1042`, but the table has a **permanent** unique `(poll_id, to_user_id)` `[CODE]` `schema/availability.ts:79` — **constraint confirmed present in the live DB** `[DB]` | Nudge payload batches recent state for all pending IDs `[CODE]` `:252-268` | Documented behavior (429 after 5 min) contradicts the schema | **Yes** |
| **Convert poll → event** | Stamps `converted_event_id` | **Medium — UNGUARDED**: read creator, then unconditional UPDATE by id; no `converted_event_id IS NULL` CAS, no transaction, not coupled to event creation `[CODE]` `routes/availability.ts:538-560`, `storage.ts:960-964` | O(1) | Comment claims idempotent; re-converting with a *different* eventId silently re-stamps `[CODE]` | **Yes** |
| SSE live updates | Postgres LISTEN/NOTIFY signal → clients refetch | Low — signal only | Every mutation triggers a full-payload refetch by every watcher `[INFER]` | — | No |

### Feed, moments, vault & media

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| Vibe Feed posts | Friends-only feed | Medium — edit/delete are unguarded read-then-write `[CODE]` `routes/feed.ts:348-366`, `:384-410` | Paginated to 30 with cursor `[CODE]` `:132-172`; per-post authz calls `getFriendIds`/`getSquadIds` `[CODE]` `:55-66` | Timestamp-only cursor can duplicate/omit rows on ties `[INFER]` | No |
| Feed reactions | Add/remove | **Low — guarded** by unique pair + `onConflictDoNothing` `[CODE]` `:466-469` `[TEST-EXISTS]` `feed.reactionFanout.test.ts` | SSE fan-out to every reader per reaction `[CODE]` `:482-487` | Add/remove are separate endpoints, so no atomic "toggle" | No |
| Feed comments | Add/list | Low | **Comment list unpaginated** `[CODE]` `:537-564` | — | No |
| Moments | Ephemeral media + views + reactions | Low — views and reactions both unique-constrained `[CODE]` `routes/moments.ts:307-310`, `:387-390` | Friends feed capped at 300 with no cursor `[CODE]` `:222-247`; **squad feed has no limit at all** `[CODE]` `:260-277`; viewer list unpaginated `[CODE]` `:318-345` | Every view emits a feed update — noisy at scale `[CODE]` `:293-312` | No |
| Vault hearts | Toggle heart | **Low — correctly atomic**: delete-with-RETURNING then insert-on-conflict-do-nothing `[CODE]` `storage.ts:546-572` `[TEST-EXISTS]` `vault.interactions.test.ts` | Count is a live aggregate, not a stored counter | — | No |
| Vault favorites | Add/remove | Low — unique index makes add idempotent `[CODE]` `schema/favorites.ts:14-25` | Unpaginated GET `[CODE]` `routes/vault.ts:249-269` | **DELETE lacks the Pro/access check that POST has** `[CODE]` `:293-305` vs `:322-332` | No |
| Vault photos / comments / share | Upload, comment, share to feed | Low/Medium | **Vault GET returns all photos, no pagination** `[CODE]` `:69-160`; share fans out per friend `[CODE]` `:639-683` | Shared copies and originals have divergent lifecycles | No |
| Object storage ACL + provenance | Signed uploads, gated reads | Low — ownership insert idempotent `[CODE]` `storage.ts:1654-1676` | Sequential ACL checks across photo/message/feed/moment per object request `[CODE]` `:177-204` | `isPublicAccess` read from raw body outside the validated schema `[CODE]` `:78` | No |

### Messaging & notifications

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| DMs / conversations | 1:1 threads via sorted `directKey` | Medium — thread/participant creation upserted `[CODE]` `storage.ts:1168-1229`; **last-message denormalization has no ordering guard** `[CODE]` `:1598-1610` | Cursor-paginated messages `[CODE]` `routes/conversations.ts:154-173`; participant list unpaginated | Read state is a timestamp ("read up to now"), not a message-id high-water mark | No |
| Squad chat | One conversation per squad | Medium — message + last-message writes unguarded `[CODE]` `storage.ts:1588-1612`; no send idempotency key, so retries duplicate `[INFER]` | O(n) participant read → mute filter → token lookup → one push per token `[CODE]` `routes/conversations.ts:239-273`; no coalescing | Participants sync only on access, so stale rows persist after membership changes | **Yes** |
| Push fan-out system | Token registration, preference/mute filtering, chunked send | Medium — registration idempotent `[CODE]` `routes/pushTokens.ts:33-52`; no duplicate-send key for chat | Expo chunks are sent sequentially with awaited stale-token cleanup `[CODE]` `lib/pushNotifications.ts:96-129` | Fire-and-forget after HTTP response — delivery state decoupled from message state | **Yes** |
| Push receipt check | 15-min receipt poll | **UNGUARDED across instances**: pending tickets live in process memory `[CODE]` `lib/pushNotifications.ts:176-180` | Unbounded in-process ticket map | Delivery state is lost on restart | No |
| Push-tap routing | `data.screen` → client route | None | — | Every new push type needs a matching client case | No |

### Identity, moderation, money

| Feature | What it does | WC | Large-group (50+) | Simplicity flag | DD |
| --- | --- | --- | --- | --- | --- |
| Friends / friend requests | Request → accept → symmetric rows | Medium — inserts use `onConflictDoNothing` `[CODE]` `routes/friendRequests.ts:111-120`, but state update + friendship insert are not shown in one transaction `[CODE]` | Friend ID list returned unpaginated `[CODE]` `storage.ts:722-728` | Symmetric duplicate rows complicate deletion | No |
| Profile / account edit | — | Low | — | — | No |
| Account deletion + tombstones | Purge relational + embedded + denormalized data; tombstone auth subjects | Medium — purge is one transaction `[CODE]` `routes/account.ts:113-114`; external subscription cancellation is explicitly best-effort outside it `[CODE]` `:85-110` | Loops every squad and conversation → transaction duration grows with relationships `[CODE]` `:116-180` | Billing can survive local deletion if cancellation fails | No |
| Report / block / auto-hide | 3 distinct reporters → hidden | Medium — report insert idempotent `[CODE]` `routes/moderation.ts:129-138`; threshold read + update not atomic `[CODE]` `:42-91` | Block expansion runs two full relationship queries `[CODE]` `:287-300` | Auto-hide hides content *and* profile | No |
| Squadz+ entitlement (RevenueCat) | Webhook is sole server-state flip | Low — idempotency keyed on original transaction id `[CODE]` `lib/revenuecat.ts:84-104` | O(1) | Stripe path dormant alongside RevenueCat | No |
| Founding ledger | Finite discount spots | **Low — well guarded**: advisory transaction lock + conflict-safe upserts `[CODE]` `lib/founding.ts:84-114`, `:145-205` `[TEST-EXISTS]` `founding.reconcile.test.ts` | O(1) | — | No |
| Calendar `.ics` export | Client-side file | None — client-only `[CODE]` `lib/ics.ts:160-178` | Serializes all items into one payload | — | No |
| Cross-squad conflict detection | Advisory overlap warnings | None — client-only read `[CODE]` `lib/conflicts.ts:1-145` | O(plans) per user | Warnings never block, so meaning is ambiguous | No |

### Background & scheduled processes

| Process | What it does | Cross-instance safety | Large-group / scale | DD |
| --- | --- | --- | --- | --- |
| Startup schema sync | `CREATE/ALTER ... IF NOT EXISTS` | Idempotent DDL, but **every instance runs it** `[CODE]` `index.ts:80-93` | Delays every instance's readiness | No |
| Reminder scanners (starting-soon, day-of, 3-day) | Fire-once reminders | **Guarded**: atomic UPDATE claim returning one row when marker is NULL `[CODE]` `lib/eventReminders.ts:81-82` | Each claimed event pushes to its whole roster | No |
| Post-event recap scanner | Photo recap prompt | **Guarded**: claim released on send failure `[CODE]` `:250-310` | Roster-sized fan-out | No |
| Availability poll scanner | Poll nudges | Roster-sized fan-out `[CODE]` `routes/availability.ts:825+` | — | No |
| Push receipt check | Expo receipts | **No DB claim** — process-local only `[CODE]` `lib/pushNotifications.ts:176-180` | Scales with send volume | No |
| Media backup → R2 | Nightly copy | **Well guarded**: `pg_try_advisory_xact_lock`, success marker committed inside the lock `[CODE]` `lib/mediaBackup.ts:284-290`, `:336-339` `[TEST-EXISTS]` `mediaBackup.test.ts`, `restoreDrill.test.ts` | Serial object processing, each buffered in memory `[CODE]` `:149-160` | No |
| Media backup freshness check | Staleness alarm | **No distributed claim** — can alarm on every instance `[CODE]` `:371-385` | O(1) | No |
| DB pool monitor | Logs pool health | Read-only `[CODE]` `index.ts:169-176` | O(1) | No |
| Activity purge / orphan cleanup | Row hygiene | `[TEST-EXISTS]` `squads.activityPurge.test.ts`, `squads.orphanCleanup.test.ts` | — | No |

---

## Stage 2 — Prioritized decision list

### Highest concern (deep-dive warranted)

**1. Squad membership removal is an unguarded lost update — the same bug class as #575.**
`routes/squads.ts:1178`, `:1205-1209` `[CODE]`. The handler reads the squad, filters
`member_ids` in application memory, then writes the whole array back with
`WHERE id = ?` — **no version predicate, and it does not bump `version`**. Join is
carefully atomic (`NOT @>` append + version bump inside an advisory lock), so the
two paths are asymmetric: a join landing between the removal's read and write is
silently erased. Because removal also skips the version bump, a concurrent PATCH
holding a pre-removal version still matches and can resurrect the removed member.
Both directions lose data. This is the single most likely place in the app for a
member to "come back" or a new joiner to vanish, and it is most likely in exactly
the situation the audit cares about: a busy 50-person squad.
*A deep-dive should examine:* all `member_ids` writers as one set, whether membership
should move off a JSON array onto rows, and whether removal should take the same
advisory lock as join. Note the existing task "Catch cases where a removed member
still appears active in squad chats" is plausibly a downstream symptom of this
`[INFER]`.

**2. Availability nudge will 500 on the second nudge to the same member.**
The route enforces a *5-minute* debounce and then plain-`INSERT`s
(`routes/availability.ts:810-823`, `storage.ts:1038-1042`) `[CODE]`, but the table
carries a **permanent** unique constraint on `(poll_id, to_user_id)`
(`schema/availability.ts:79`) — and I confirmed that index exists in the live
database `[DB]`. So the first nudge succeeds; every later nudge to that same member
in that same poll raises a unique violation and returns 500 instead of the designed
429. The existing test mocks storage, so it cannot catch this `[CODE]`
`availability.nudgeMembership.test.ts`. The dev table currently has 0 rows `[DB]`,
which is consistent with the path never having been exercised end-to-end.
*A deep-dive should examine:* whether the intent is one-nudge-ever or a rate limit,
then reconcile schema and route (upsert on conflict vs dropping the constraint), and
add a test that hits a real database rather than a mock.

**3. Event chat is an unbounded JSON array on the shared event row.**
`routes/events.ts:1958-1973` `[CODE]`. Every send reads the entire message history,
copies it in memory, writes the whole array back, and returns the **entire event**
to the client — then SSE-pokes every watcher to refetch. Cost per message grows with
history length, so a 50-person trip chat degrades quadratically `[INFER]`. It also
shares one `version` with tasks, packing, itinerary and RSVP, so unrelated edits
contend. A separate, properly paginated chat system already exists in the
`conversations` tables.
*A deep-dive should examine:* migrating event chat onto the existing conversations
tables, and whether one version per event is the right granularity.

**4. Poll → event conversion has no claim, so one poll can spawn two plans.**
`routes/availability.ts:538-560` + `storage.ts:960-964` `[CODE]`: creator check, then
an unconditional `UPDATE ... SET converted_event_id` with no `IS NULL` predicate and
no coupling to event creation. A double-tap or retry produces two events, with the
poll pointing at whichever wrote last. Poll *creation* has the matching weakness —
find-then-create with no unique scope constraint `[CODE]` `:322-343`. Only the
creator can convert, so this is a single-user retry race rather than a group race,
which is why it ranks below the first three.
*A deep-dive should examine:* a conditional CAS on `converted_event_id IS NULL` and
whether conversion and event creation belong in one transaction.

**5. Notification fan-out has no coalescing and no cross-instance receipt ownership.**
Each squad chat send does an O(n) participant read → mute filter → token lookup →
one push per token, sequentially chunked `[CODE]` `routes/conversations.ts:239-273`,
`lib/pushNotifications.ts:96-129`. A lively 50-person squad multiplies every message
by 49 pushes with no debounce (the DB-backed debounce exists for other notification
types, not chat). Separately, push receipts are tracked in **process memory**
`[CODE]` `lib/pushNotifications.ts:176-180`, so they vanish on restart and are not
shared across instances.
*A deep-dive should examine:* chat notification coalescing, and moving receipt
tracking to the DB-backed claim pattern the reminder scanners already use well.

### Simplicity wins

1. **`PATCH /squads/:id` does three unrelated things with three different rules** —
   removals apply immediately, additions silently become pending invites, and
   reordering is permitted `[CODE]` `routes/squads.ts:690-712`. Worse, member order
   *is* the ownership succession rule `[CODE]` `:1194-1203`, so a cosmetic reorder
   quietly changes who inherits the squad. Splitting these into explicit endpoints
   would remove a whole class of surprise.
2. **Two chat systems with different rules.** Event/trip chat is an unpaginated JSON
   array; DMs and squad chat are paginated tables with read receipts `[CODE]`.
   Users experience one "chat" concept; the app has two.
3. **Two invite models.** Squad invites are pending relational rows requiring
   acceptance; event invites are a JSON array granting immediate access `[CODE]`.
   Acceptance and conflict semantics diverge for what users read as one action.
4. **Ideas and itinerary stops are two ordering systems merged into one view**
   `[CODE]` `routes/ideas.ts`, `schema/ideas.ts:20-32`. Confirmed ideas render inside
   the itinerary but are stored separately and are not protected by `events.version`.
5. **Availability silently discards input.** Out-of-grid or duplicate cells are
   dropped and reported only as a `droppedCount` `[CODE]`
   `routes/availability.ts:888-895`; concurrent same-user edits silently overwrite.
   For the app's headline feature, silence is the wrong default.
6. **Vault favorites enforce Pro on add but not on remove** `[CODE]`
   `routes/vault.ts:293-305` vs `:322-332` — small, but it is a policy asymmetry.

### Confirmed solid (no further work needed)

These were inspected this pass and are genuinely well built — several are textbook
examples the rest of the codebase should copy:

- **Vault heart toggle** — delete-with-`RETURNING` then insert-on-conflict, with a
  comment explaining precisely the race it defeats `[CODE]` `storage.ts:546-572`.
  (An earlier automated pass in this audit mis-flagged this as risky; direct reading
  disproved that.)
- **Squad join** — atomic `NOT @>` append + version bump inside the free-squad-cap
  advisory lock `[CODE]` `routes/squads.ts:149-163`.
- **Itinerary stops and packing lists** — mandatory version CAS with 409 on all
  five/three operations respectively `[CODE]` `routes/events.ts:2142-2302`, `:2331-2414`.
- **Event edit CAS and RSVP JSONB merge** — correct, and correctly *different*: RSVP
  intentionally avoids whole-event CAS so one person's RSVP never 409s another's
  `[CODE]` `:835-855`, `:1119-1129`.
- **Availability response upsert** — unique `(poll,user)` upsert `[CODE]`
  `storage.ts:980-987`.
- **Founding-spot ledger** — advisory transaction lock plus idempotent per-subscription
  key `[CODE]` `lib/founding.ts:84-205`.
- **Media backup to R2** — `pg_try_advisory_xact_lock` with the success marker
  committed inside the lock `[CODE]` `lib/mediaBackup.ts:284-339`.
- **Reminder and recap scanners** — atomic claim-by-UPDATE, with the claim released
  on send failure `[CODE]` `lib/eventReminders.ts:81-310`.
- **Feed reactions, moment views and moment reactions** — unique-constrained with
  conflict handling `[CODE]`.
- **Report insertion and the report-visibility gate** — idempotent, and gated on the
  reporter actually being able to see the content `[CODE]` `routes/moderation.ts:129-138`.

### Latent but not currently live

Server-side, the version predicate is **optional** on event tasks, event chat, event
polls and squad PATCH — omit `version` and the write proceeds unguarded `[CODE]`.
The shipped mobile client always sends a version (falling back to `0`, which
deliberately forces a 409 rather than a silent overwrite) `[CODE]`
`context/AppContext.tsx:1891-2607`, so this is a defense-in-depth gap rather than a
live bug today. It becomes live the moment any other client, script, or retry path
omits the field.

### Not reached in this pass

Stated plainly rather than glossed: **cost splitting** (excluded by instruction);
the **Stripe** route internals (dormant path behind RevenueCat); the **squad invite
acceptance** handler; **auth/session** flows; and the marketing web artifact. No
test suites were executed in this pass, so every `[TEST-EXISTS]` label means the
file exists and nominally covers the area — not that it passes today. The three
findings ranked #1, #2 and #3 above are the ones I would confirm with a real-database
concurrency test before anything else.
