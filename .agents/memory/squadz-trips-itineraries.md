---
name: Squadz Trips & Itineraries
description: How trips are modeled on the shared events object, the invariants for itinerary/packing routes, and an Expo-web reload gotcha that masquerades as a feature bug.
---

# Trips & Itineraries (mobile-only feature on the shared `events` object)

A **trip is an event** with `type:"trip"` plus `startAt`/`endAt`/`allDay`/`coverStyle` and two JSON columns `itinerary` (ordered stops) + `packing` (shared checklist). No separate table, no maps (freeform `placeName`/`address`). Mobile (`artifacts/squadz-native`) only; web is marketing.

## Route invariants (api-server `src/routes/events.ts`)
- **Trip-type guard:** every itinerary/packing mutation must call `ensureTripEvent()` (returns 400/404 if the event isn't a trip) BEFORE mutating — stops/packing must never be attached to a plain event.
- **Version required, not optional:** all trip mutation Zod bodies (AddStop/PatchStop/Vote/Confirm/AddPacking/PatchPacking) require a numeric `version`; the two DELETE routes read `req.body.version` manually and must 400 when it's missing. This is the standard events.* optimistic-concurrency rule (WHERE id AND version, bump version, 409 on conflict) — applies to JSON-column writes too.
- **Authz = LIVE squad membership** (re-checked per request via `getSquadIdsForUser`), never a trusted stored row. Trips are visible to current squad members with NO RSVP required; the GET /events visibility `or()` also includes `hostId === user` so personal/no-squad trips show for their creator. Range-aware expiry keeps a trip while `endAt >= startOfToday`.
- **Trip access must IGNORE the `rsvps` map** — route everything through the single `userCanAccessEvent()` gate: host → allow; `type==="trip"` → live squad membership only; plain event → `userId in rsvps`. **Why:** a member can RSVP "going" to a trip and later be removed from the squad; the stale RSVP key stays in `event.rsvps`, so any check that ORs `userId in rsvps` (detail GET, SSE stream, and the list visibility `rsvps ? userId`) silently re-grants a removed member access. The list query's RSVP clause must be AND'd with `type <> 'trip'`. **How to apply:** never add a new trip read/stream endpoint with its own host-or-RSVP check — reuse `userCanAccessEvent`, and keep RSVP visibility for plain events only.

## Client (mobile)
- `tripApi.ts` version arg is optional at the type level, so callers MUST pass `event.version` explicitly (trip/[id].tsx does). `dbEventToEvent` maps `version ?? 1`, and `addEvent` stores the server response (real id + version) — so a freshly created trip has a valid numeric version for the first mutation.
- **Templates are Squadz+-gated:** `create.tsx` only materializes template stops `if (template && isPro)` and threads the version forward (start v=1, update from each `addStop` response) so the version-checked route accepts the chained appends. The pro re-check is server-trust-free to block the deep-link `/create?...templateId=` bypass.

## Past trips need a single-event fallback fetch
`refreshEvents()` loads `/api/events` (upcoming-only, no `includePast`), so the Plans→Past segment trips are NOT in `AppContext.events`. `trip/[id].tsx` therefore resolves `getEvent(id) ?? fallbackEvent`, where `fallbackEvent` is fetched directly from `GET /api/events/:id` (which has no expiry filter and proper host/RSVP/trip-member authz). Without this, opening any past trip shows "This trip isn't available."
**How to apply:** any detail screen that can be reached from an `includePast` list must fall back to the single-event endpoint, and post-mutation refresh must re-fetch that single event too (the list won't contain past items).

## Expo-web reload gotcha (NOT a feature bug)
A hard browser reload of a deep route like `/trip/<id>` on Expo **web** bounces to Home (shows "Reconnecting") while the auth token rehydrates — the deep route is not restored. This made e2e "reload to verify persistence" steps fail with "This trip isn't available" / Home redirect even though the data was saved correctly.
**Why:** auth rehydration on web cold-load redirects before the saved route resolves.
**How to apply:** Never verify mobile persistence via `page.reload()` on Expo web. Instead force an in-app re-render (switch tabs / re-focus the screen, which triggers `refreshEvents()`), or assert against the backend directly. The data layer was always correct; only the reload harness was wrong.
