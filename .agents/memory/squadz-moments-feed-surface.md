---
name: Squadz Moments single feed surface
description: Moments display lives only in the Vibe Feed ring row; how friends+squad moments are aggregated and scoped.
---

# Moments: one display surface (the Vibe Feed ring row)

Moments are **only** shown in the Vibe Feed tab's ring row. The squad detail
screen has NO Moments UI (no ring row, no squad-anchored composer). Do not
re-add a squad-screen Moments surface.

## The feed ring row is an aggregate, not friends-only
`MomentsRingRow mode="feed"` calls `GET /api/moments/feed`, which returns the
union of:
- friends-audience moments from (self + friend ids), and
- squad-audience moments from **every squad the viewer currently belongs to**,
grouped into per-author rings via `buildRings`.

**Why this endpoint exists:** the older `/api/moments/friends` returns ONLY
`audience === "friends"` moments, and squad moments were previously visible
*only* through the now-removed squad-screen ring row. Without an aggregate,
removing the squad ring row makes squad moments invisible everywhere. `/feed`
is the fix so the feed is the single surface for both.

## Audience scoping is server-derived (don't regress this)
The squad set in `/feed` comes from a DB query (`member_ids @> [userId]` jsonb
containment), never from the request. A non-member can never receive another
squad's moments regardless of request shape. The legacy `mode="friends"` and
`mode="squad"` branches still exist in `MomentsRingRow` but the UI only uses
`mode="feed"`.
