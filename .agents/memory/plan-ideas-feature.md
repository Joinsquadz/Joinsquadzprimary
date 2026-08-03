---
name: Plan Ideas feature invariants
description: Binding rules for the suggest-and-vote Ideas feature on plans (trips/events) — merged rendering, reorder contract, read-only flag, no version checks.
---

Ideas live in their own tables (plan_ideas + idea_votes), NOT in the events JSON columns.

Rules future changes must keep:
- **No version checks.** Idea mutations are not part of the events.version optimistic-concurrency scheme. Do not thread `version` through the ideas client or add 409 handling.
- **Merged render is render-level only.** Confirmed ideas group by `suggestedDate` (same ISO day keys as `ItineraryStop.day`; null = "Anytime/General"). Within a day group, stops ALWAYS render first (untouched), then confirmed ideas by sortOrder. Never convert an idea into a stop (single-record rule) and never touch stop rendering/ordering code for ideas work. Pure merge helpers live in `lib/ideaUtils.ts` (unit-tested) — extend those, not the screens.
- **Reorder contract.** The reorder endpoint requires the EXACT full set of confirmed-idea ids of one day group (`date: dayKey|null`). Partial payloads 400. Client UX is long-press → up/down arrow mode (deliberate spec deviation — no drag dependency pre-App-Store).
- **Read-only comes from the server.** The list endpoint returns `readOnly: true` for cancelled/past plans; mutations 403. The client hides all IDEA write affordances off that flag — but stop/itinerary affordances are pre-existing behavior and stay as they are.
- **Status transitions:** pending↔confirmed, pending↔archived only; voting only on pending. Idea-only day keys outside the trip range render as trailing date-labelled sections (never "Day N").
- **Refresh:** ideas don't ride the SSE event stream; screens poll (piggybacked on trip refresh / own 30s interval on events) + refetch after each mutation. Vote toggles are optimistic with a per-idea in-flight guard (double-tap race otherwise lets an older response overwrite the newer one).

**Why:** these were user-approved binding decisions for the feature; the legacy `proposed`/`votes` mechanic on stops is deliberately untouched and overlaps in purpose.
