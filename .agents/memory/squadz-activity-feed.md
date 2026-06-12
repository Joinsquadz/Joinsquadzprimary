---
name: Squadz activity feed & delight banners
description: Invariants for the materialized activity feed, RSVP activity semantics, and the foreground delight banners (B1–B9).
---

# Activity feed & delight invariants

- **RSVP activity is "going"-only.** `POST /events/:id/rsvp` records an `rsvp` activity row only when status === "going"; switching to maybe/notgoing calls `removeActivity`. Invite-join path is always going.
  - **Why:** grouped activity items keep only the *newest* row's `meta` (see route grouping), so a client can't reliably filter a group's actors by per-actor status. Recording only "going" makes both the Part C feed and the B2 "is going! 🎉" momentum banner accurate without per-actor status. Non-going still sends its own push (separate path).
  - **How to apply:** never re-introduce non-going rsvp activity rows; if you need maybe/notgoing in the feed, you must stop trusting group-level `meta.rsvpStatus`.

- **Activity rows are recorded for the recipient, fire-and-forget** via `recordActivitySafe` (skips self), and pulled via `removeActivity` on undo (un-react/un-heart/rsvp-change). `/api/activity*` is `requireAuth` and always filters `recipient_id = authedUser`.

- **Delight banners are foreground-only, baseline-first, seen-flagged `_${userId}`.** B9 (new vault photos) gates on `squadsLoading === false` and bails WITHOUT burning its 6h throttle when `squads.length === 0`, so it re-fires once squads load instead of silently blocking for hours. First check per squad just sets a baseline (no backlog replay).

- **SSE hooks (`useActivityStream`, `useFeedStream`) self-reconnect.** They schedule a ~15s reconnect on EOF/error (not just on AppState→active), guarded by an abort/stopped check, because ActivityContext only refreshes on foreground (no periodic poll). Use `import { fetch } from "expo/fetch"` (RN built-in fetch has null body).

- **Stale `@workspace/db` exports after adding a schema** (e.g. `activityTable`, `ActivityType`): run `pnpm run typecheck:libs` to rebuild lib declarations before the api-server typecheck — it's stale `.tsbuildinfo`, not a bad import.
