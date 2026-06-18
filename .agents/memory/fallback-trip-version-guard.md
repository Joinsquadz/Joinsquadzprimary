---
name: Fallback-loaded trip mutations skip version guard
description: Why event-mutation helpers must accept an explicit version for past trips loaded outside the AppContext events list.
---

The trip detail screen (`app/trip/[id].tsx`) shows **past** trips that are NOT in
`AppContext.events` (the upcoming-only list) by fetching the single event into a
local `fallbackEvent`. Any AppContext mutation helper that derives its
optimistic-concurrency version via `events.find(id)?.version` (updateEvent,
addCost, markSharePaid, confirmShare, and friends) will get `undefined` for a
fallback-only event and therefore send the request **without** a `version` field
— silently dropping the 409 concurrency guard required by the events.* JSON
write convention.

**Rule:** every event-mutation helper used from a screen that can render a
fallback-loaded event must accept an optional trailing `explicitVersion?: number`
and prefer it: `explicitVersion ?? events.find(id)?.version`. Callers that hold
the full event object (e.g. shared panels like `EventCostsPanel`) pass
`event.version`.

**Why:** the in-list lookup is empty for past trips, so the guard is skipped
exactly where post-trip settle-up edits happen. The architect flagged this as a
blocking gap when trips gained cost-splitting.

**How to apply:** when adding a new event-write helper or a new
trip/event-shared panel, thread `event.version` through rather than relying on
the list lookup. Note the optimistic `setEvents` update + `applyEventUpdate` are
no-ops for fallback-only trips; their UI converges via the trip screen's SSE +
30s poll `refresh()`, not optimistic state.
