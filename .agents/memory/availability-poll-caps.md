---
name: Availability poll day/cell caps
description: Cross-file constraint linking the mobile day-count UI to the server Zod array caps for availability polls.
---

# Availability poll caps must stay in sync across three places

The "Find the Best Time" feature has three numeric caps that MUST agree, in two
different files:

1. Mobile day-count chips — `DAY_COUNT_OPTIONS` in `artifacts/squadz-native/app/availability.tsx`.
2. Server `days` array cap — `CreatePollBody.days` AND `UpdatePollBody.days` in `artifacts/api-server/src/routes/availability.ts`.
3. Server `cells` array cap — `UpsertResponseBody.cells` in the same server file. This must be `>= maxDays * maxSlots` (slots cap is 48).

**Why:** The UI once offered up to 30 days while the server `days` array was
`.max(14)`, so any poll >14 days failed at create time with a Zod `too_big`
error on `days` (the user only saw a raw Zod error dump). The `cells` cap is the
per-response grid size = days × slots; if it lags the days cap, a fully-filled
large poll silently rejects the response upsert.

**How to apply:** When changing the day options or the range, update the server
`days` cap in BOTH schemas and recompute `cells = maxDays * 48`. Current values:
days `.max(31)`, slots `.max(48)`, cells `.max(1488)`, UI max option 30.

# Grid is windowed, not all-on-screen

The availability grid pages through days `DAY_WINDOW` (5) at a time via a
prev/next arrow pager (`dayWindowStart` state), instead of rendering every day
as a `flex:1` column. A wide poll (14+ days) used to render as a cramped wall of
tiny columns. Header row and slot rows both map `visibleDays` (the clamped
slice), so they stay column-aligned. Keep that invariant if you touch the grid.
