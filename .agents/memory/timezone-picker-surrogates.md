---
name: Timezone picker surrogates
description: How native date pickers must handle the user's chosen (non-device) time zone in squadz-native.
---

Native date pickers can only display/return a Date's *device-local* fields, but times entered in the app are wall clocks in the user's effective zone (`TimezoneContext.timezone`, which can differ from the device zone).

**Rule:** treat picker Dates as wall-clock *surrogates*, never instants.
- Seeding a picker from an existing instant: convert with `instantToZoneWallClockDate(instant, timezone)` (lib/timezoneFormat.ts) so the picker shows the chosen-zone wall clock. Also convert any `minimumDate` into the same surrogate space.
- Persisting a picked value: convert back with `deviceWallClockToZoneIso(picked, timezone)`. Both are identities when zones match.
- Keep state (e.g. `eventAtISO`, `editEndAt`) consistently as absolute instants; convert at the picker boundary, not at save-with-a-changed-check (mixed semantics got a code review rejected).
- Events are stamped with the effective `timezone`, NOT `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Prefilled instants (poll "best time") are already absolute — pass through untouched.
- When the chosen zone differs from the device zone, show a "Times are in <zoneLabel>" hint next to time inputs.

**Why:** a user with a manual zone (e.g. NY device, LA chosen) picking "6:00 PM" must get 6 PM in the chosen zone; raw `toISOString()` stores the device reading, off by the offset difference.
