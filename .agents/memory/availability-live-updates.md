---
name: Availability poll live updates
description: SSE live-update wiring for the availability screen and the pollId-vs-find refresh trap.
---

Availability polls have an SSE live-update layer (server `lib/availabilityEvents.ts` emitPollUpdate/onPollUpdate; route `GET /availability/polls/:id/stream`; mobile `hooks/useAvailabilityStream.ts`). Server emits at PATCH `/:id`, POST `/:id/nudge`, PUT `/:id/me` success points. The stream route reuses the SAME authz as `GET /availability/polls/:id` (getAvailabilityPoll + canAccessAvailabilityPoll).

**Refresh-path trap:** the screen can open a poll two ways — by `pollId` param (invite-link flow, no squadId/eventId) OR by squadId/eventId (resolves via `/availability/polls/find`). Any non-disruptive refresh (`refreshInBackground`, the SSE `onUpdate`, the 20s interval) MUST branch on `pollId`: fetch `/availability/polls/:id` when pollId is present, else `/find?squadId|eventId`. If you only use `/find`, the invite-link pollId screen silently never refreshes (empty/invalid query) — looks like SSE is broken but it's the loader.

**Why:** `/find` requires squadId or eventId; the pollId-only invite flow has neither, so `/find` is a dead request there.

**How to apply:** SSE is best-effort — always keep the 20s polling fallback. The hook is focus-scoped (useFocusEffect), exponential-backoff retries, and reconnects on AppState "active" (mobile OSes kill backgrounded TCP). Same pattern as `hooks/useSquadStream.ts`.
