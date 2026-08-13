---
name: RN unsaved-change leave guards
description: beforeRemove-based "unsaved changes" guards also fire on programmatic navigation, so success paths must bypass them explicitly.
---

A screen's unsaved-change guard belongs on a single `navigation.addListener("beforeRemove")`
handler, NOT on the header back button. One listener is the only way header back,
Android hardware back, iOS swipe-back and any in-screen Cancel behave identically —
wiring the confirm dialog into the header `onPress` leaves the gesture and hardware
paths silently unguarded.

**But:** `beforeRemove` also fires for navigation the screen itself initiates, and the
state updates that clear the dirty flags only land on the NEXT render. So the success
paths — created the thing, deleted it, saved and left — trip the guard and prompt
"leave without saving?" one beat after the work completed.

**Why:** dirty flags are React state/refs updated in the same tick as the
`router.replace` / `router.back` call; the listener reads the pre-update value.

**How to apply:** keep a `bypassLeaveGuardRef` that the listener checks and clears
first, and route every post-success navigation through a small
`leaveAfterSuccess(go)` helper that sets it. Anything the USER initiates goes
through the guard untouched. This applies to any screen adding a leave guard, not
just the availability/poll screen.
