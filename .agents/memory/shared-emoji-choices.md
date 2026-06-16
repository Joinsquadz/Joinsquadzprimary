---
name: Shared emoji/icon choices
description: Single source for squad/event icon pickers and the grid-vs-scroll layout constraint
---

All squad + event icon pickers import one shared array,
`constants/emojis.ts` → `EMOJI_CHOICES` (large, curated, grouped: vibes,
sports & fitness incl. golf/gym/tennis/hiking, games, food, travel, misc).
Used by squad create/edit and event create/edit.

**Layout rule:** the full-screen CREATE screens (`app/squad/create.tsx`,
`app/create.tsx`) render the set as a wrapping grid (`emojiGrid`:
row + flexWrap) inside their vertical ScrollView, so all options are visible.
The EDIT modals (`app/squad/[id].tsx`, `app/event/[id].tsx`) keep a horizontal
ScrollView.

**Why:** the squad settings modal (`styles.modalCard`) has NO vertical scroll
wrapper — a tall wrap grid there pushes content (mute toggle, leave/delete) off
screen. A horizontal row never overflows the modal vertically.

**How to apply:** to add icons, edit only `EMOJI_CHOICES`. Don't convert an
edit modal to a wrap grid unless you first give that modal its own vertical
ScrollView. Onboarding keeps its own smaller `SQUAD_EMOJIS` (its color logic
uses `SQUAD_EMOJIS.indexOf(...)`) — intentionally not unified.
