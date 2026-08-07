---
name: materialEditCooldown test mock
description: How the events.materialEditCancelPush.test.ts mock handles two update.returning() calls per PATCH.
---

## Rule
The PATCH /events/:id handler issues up to TWO `db.update(eventsTable).returning()` calls:
1. The main version-checked update (always happens).
2. The atomic cooldown stamp UPDATE (only for material edits: time/location/title changes).

The test file uses a **call counter** (`updateReturnCallN.n`) to dispatch the right mock value to each call:
- Call ≤ 1 → `mockUpdateRows.value` (the updated event row)
- Call > 1 → `mockCooldownStampRows.value` (controls whether push fires)

**Why:** A shared `mockUpdateRows.value` for all `returning()` calls made both the main update and the cooldown stamp return the same row. The cooldown stamp must return `[]` to suppress the push (active cooldown) or `[{ id }]` to fire it. Without the counter, debounce suppression tests always got a truthy stamp result and the push fired incorrectly.

**How to apply:** In `beforeEach`, reset `updateReturnCallN.n = 0` and set `mockCooldownStampRows.value = [{ id: "evt-1" }]` (default = cooldown wins → push fires). For tests that verify debounce suppression (cooldown active), set `mockCooldownStampRows.value = []` in the test body.
