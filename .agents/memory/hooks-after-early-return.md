---
name: Hooks after early return crash detail screens
description: Why past/fallback-hydrated plan detail screens crash with a React hooks-order error, and the rule that prevents it.
---

Detail screens (trip/event) render once with `event === undefined` (cold fallback fetch for past plans / deep links) and early-return a "not available" view. Any hook declared BELOW that early return changes the hook count when the event hydrates → "React has detected a change in the order of Hooks" → error boundary ("Something went wrong").

**Why:** the past-trip route crashed exactly this way (lock-in-flash hooks lived below the early return); upcoming trips never hit it because they come from context on first render, so the bug only surfaces on past/deep-linked plans.

**How to apply:** in `app/trip/[id].tsx` / `app/event/[id].tsx` (and any screen with a "missing data" early return), declare ALL hooks above the early return; derive data with optional chaining (`event?.itinerary ?? []`). Check this whenever adding a hook to these screens.

**Also:** confirmed ideas intentionally disappear from the Ideas board (banner "N confirmed ideas are on the itinerary") and render only inline in the itinerary — not a bug when a tester reports a confirmed idea "missing" from the Ideas tab.
