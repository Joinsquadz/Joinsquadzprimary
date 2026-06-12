---
name: SSE needs expo/fetch on native
description: Why React Native SSE hooks must use expo/fetch, not the built-in fetch
---

React Native's built-in `fetch` does NOT populate `response.body` (it has no
ReadableStream), so any SSE hook that does `response.body.getReader()` can never
start streaming on a device — `!response.body` is true → it retries forever and
the "reconnecting" indicator is stuck on permanently. It only ever worked in the
web preview (browser fetch supports streaming bodies).

**Rule:** SSE / streaming-response hooks must `import { fetch } from "expo/fetch"`
(streaming-capable on both native AND web), not the global `fetch`.

**Why:** the squad screen's reconnecting spinner never cleared on native because
`useSquadStream` used global fetch. The per-screen squad stream is purely a
cosmetic live/reconnecting indicator — actual data refresh comes from the global
AppContext stream + a 60s focus poll — but the stuck banner still looked broken.

**How to apply:** the same pattern affects useConversationStream, useEventStream,
useAvailabilityStream, and the AppContext global squad stream — they all use
global fetch + getReader and silently never connect on native (no banner, so less
visible). Migrate them to expo/fetch if live updates must work on device.

**Testing gotcha:** hook tests mock global `fetch` via `vi.stubGlobal`. After the
swap you must also `vi.mock("expo/fetch", ...)` routed through a `vi.hoisted`
holder that beforeEach points at the per-test fetch mock, or the real expo/fetch
loads under node and tests fail.
