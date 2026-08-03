---
name: Push-tap routing contract
description: Server push payload `screen` values must have matching cases in the mobile push-tap router
---

Every push payload's `data.screen` value must have a matching case in `routeFromNotificationData` (squadz-native app/_layout.tsx), and `tab` must be forwarded to the target screen params — otherwise taps silently land on Home.

**Why:** idea pushes originally carried no `screen` at all, and the router lacked a `trip` case even though the server sent one; taps did nothing.

**How to apply:** when adding any new push, set `screen` (+ `tab` if the target screen reads a tab param) server-side AND add/verify the client case. Same for new `recordActivitySafe` types — the Activity screen's label switch and navigate switch both need cases (include `planType` in meta to pick /trip vs /event). Also: completion review expects query-aligned indexes in schemaSync for any new hot table.
