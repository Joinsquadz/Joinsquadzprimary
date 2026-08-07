---
name: Scale Hardening (P1–P3)
description: Atomic scanner claims, DB-backed debounce, SQL time-window filters, GET /events pagination, 6 new indexes — all implemented and tested.
---

## Atomic Claim Pattern (P1a)

For each of the 5 engagement scanners (Reminder, DayOf, 3Day, Recap, PollNudge), the send path changed from:
- mark AFTER successful send → mark BEFORE send (atomic claim), release (unclaim) on failure

Storage methods added (pairs for each scanner):
- `tryClaimEventReminderSend / unclaimEventReminderSend`
- `tryClaimDayOfReminderSend / unclaimDayOfReminderSend`
- `tryClaimEvent3DayReminderSend / unclaimEvent3DayReminderSend`
- `tryClaimEventRecapSend / unclaimEventRecapSend`
- `tryClaimPollNudgeSend / unclaimPollNudgeSend`

**Why:** `UPDATE … WHERE sentAt IS NULL RETURNING id` — only the winning instance gets a row back. Second instance gets false → skips send. On failure, `UPDATE SET sentAt = NULL` releases the claim for retry.

**How to apply:** `markXxxSent` is now ONLY for retirement (past/stale events, no send). Live sends MUST use tryClain/unclaim pair.

## DB-Backed Notification Debounce (P1b)

`lib/notificationDebounce.ts` rewritten from in-memory Map to `isKeyRateLimited(key, 1, windowMs)` with key format `notif_debounce:<type>:<actor>:<recipient>`.

- `shouldSendNotification` is now **async** — all 4 callers updated with `await`
- ideas.ts `.filter()` pattern changed to `Promise.all` + filter on results (can't use async inside `.filter()`)
- Degrades gracefully: DB error → `isKeyRateLimited` returns `{ limited: false }` → always allows

## SQL Time-Window Filters (P2)

Added `WHERE event_at <= NOW() + interval 'N hours'` (or `-`) to all 5 scanner SELECT queries in `storage.ts`. Events/polls outside the scanner's window are excluded at the DB level — bounded scans as the table grows.

Intervals:
- Reminder: `event_at <= NOW() + 2h`
- DayOf: `event_at <= NOW() + 14h`
- 3Day: `event_at <= NOW() + 72h`
- Recap: `event_at <= NOW() - 2h`
- PollNudge: `createdAt BETWEEN NOW()-7d AND NOW()-2h`

Note: `lte` was added to drizzle-orm imports but sql template literals are used for timestamp comparisons (cleaner for interval arithmetic).

## GET /events Pagination (P3)

- Default LIMIT 100, max 200 (`?limit=N`), response stays as plain array
- `X-Has-More: 1` header when there are more items beyond the page
- Mobile client not yet pagination-aware — backward compatible (just gets first 100)

## 6 New DB Indexes (P3)

Added to `schemaSync.ts createIndexes()` — applied via `CREATE INDEX IF NOT EXISTS` on every deploy:
- `IDX_squads_member_ids_gin` — GIN on squads.member_ids (containment queries)
- `IDX_events_squad_id` — B-tree
- `IDX_events_host_id` — B-tree
- `IDX_events_event_at` — B-tree
- `IDX_events_rsvps_gin` — GIN on events.rsvps (JSONB visibility filter)
- `IDX_events_invited_user_ids_gin` — GIN on events.invited_user_ids (JSONB visibility filter)

B-tree index declarations added to events.ts schema (informational). GIN NOT added to schema — drizzle-orm v0.45.x doesn't support `index().using("gin").on()` in pgTable (causes runtime TypeError).

## P4 Object Storage

Replit Object Storage (legacy) — `@replit/object-storage` SDK in api-server. To count: run `await client.list()` with pagination in the server environment. GCS credentials from sidecar at `http://127.0.0.1:1106/credential` give an access_token but direct GCS API returns 401 (token is for internal Replit routing, not GCS).

## Test Count

Baseline: 952 → after: 957 (5 new tests added across eventReminders.test.ts and notificationDebounce.test.ts).

## Deployment Note

Production deploy needed to apply new schemaSync indexes to the prod DB. After deploy, the `[schemaSync] Schema sync complete` log confirms all 6 indexes were applied.
