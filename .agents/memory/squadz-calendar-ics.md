---
name: Squadz calendar = per-plan .ics, no sync feed
description: Calendar Sync (token feed + calendarSyncEnabled pref) was deliberately removed; calendar integration is per-item .ics export + private client-side conflict detection.
---

**Rule:** Do not re-add a Calendar Sync feed/toggle. Calendar integration is per-plan "Add to calendar" (.ics download/share) plus private, client-side cross-squad conflict banners.

**Why:** Product decision (July 2026): a subscribable feed leaked plan data via an unauthenticated token URL and required server state; per-item export is free, private, and gating-free. DB columns `calendarSyncEnabled`/`calendarToken` were intentionally LEFT in the schema (no drop migration); the server silently ignores stale clients PATCHing them.

**How to apply:**
- ICS generation lives client-side in `squadz-native/lib/ics.ts` (`buildPlanIcs`): events → UTC-timed VEVENT from `eventAt` (2h default) → floating-local from display-date time → all-day fallback; trips → all-day span VEVENT (exclusive DTEND) + timed itinerary stops as floating-local VEVENTs in the SAME VCALENDAR. Sharing via `lib/shareIcs.ts` (web blob download / native expo-file-system + expo-sharing, Platform-guarded dynamic imports).
- Conflict detection is client-only (`lib/conflicts.ts`): only the current user's own plans (host/going/maybe for events; roster for trips), never other users'. Trip/trip range intersect = hard, trip/event day-in-range = hard, event/event same-day timed overlap = hard, missing time = soft. Banner (`components/ConflictBanner.tsx`) is informational, never blocks.
- `expo-calendar` was removed from package.json — don't reintroduce it for this; .ics export needs no calendar permission.
