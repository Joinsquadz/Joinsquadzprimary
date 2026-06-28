---
name: Event/trip chat timestamps & unread
description: Why event/trip chat messages need a real createdAt, and how Messages-list ordering + unread for them works.
---

Event & trip chats are JSONB `messages[]` on the `events` row (NOT conversations), so they have no server-side participant/read tracking like conversations do.

**Rule: every event/trip chat message must carry an ISO `createdAt`.**
**Why:** messages historically stored only `time: "Just now"` (a frozen display string). The Messages list derived its sort key from that, so `new Date("Just now")` = NaN → those chats sank below every real conversation (stable sort appends NaN-keyed items last) and users reported "trip chats don't show up." Both the server message-append route and the client optimistic insert now set `createdAt`; `time` is kept only for back-compat display.
**How to apply:** when adding any new event/trip message path, set `createdAt`. The list sort is NaN-safe (NaN→0) but that only sinks the item; correct ordering needs a real timestamp. A one-off backfill stamped legacy rows from `events.created_at`.

**Unread for event/trip chats** is client-only: `eventReads` map (eventId→ISO) in AsyncStorage key `event_chat_reads_<userId>`, set by `markEventChatRead` (monotonic, never moves backward) when the chat tab is opened on the event/trip detail screen. A row is unread when the latest message has a `createdAt`, was sent by someone else, and is newer than the stored read marker. Legacy messages without `createdAt` never count as unread (no false positives).

**Backfill version note:** a display-only JSONB backfill on `events` does NOT need a `version` bump despite the optimistic-concurrency on message writes — write routes build updates from current DB state, so there's no lost-update risk and bumping would only cause spurious 409s on active clients.

**Routing:** the Messages list must route `type==="trip"` rows to `/trip/:id` and others to `/event/:id` (it previously sent everything to `/event/:id`).
