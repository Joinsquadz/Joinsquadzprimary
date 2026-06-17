---
name: Shared emoji/icon choices
description: Single source for squad/event icon pickers; create screens use IconPicker, edit modals use the flat grid
---

`constants/emojis.ts` is the single source of truth for squad/event icons.
`EMOJI_CATEGORIES` (each item carries search `keywords`) is canonical;
`EMOJI_CHOICES` (flat list) and `CURATED_EMOJIS` (8 quick picks) are DERIVED
from it — never hand-maintain a parallel list or the picker + edit screens
drift.

**Create screens** (`app/squad/create.tsx`, `app/create.tsx`) use the shared
`components/IconPicker.tsx` (Variant A "Curated Row + More"): ~8 curated quick
picks inline (wrapping row, all visible) + a "More" tile opening a searchable,
categorized bottom-sheet over the full set. Pass `accent` to recolor the
selected state (squad/create passes its dynamic `color`; event/create defaults
to brand primary). Do NOT re-add a full inline emoji grid to these screens.

**Edit modals** (`app/squad/[id].tsx`, `app/event/[id].tsx`) still render the
flat `EMOJI_CHOICES` in a horizontal ScrollView.
**Why:** the squad settings modal (`styles.modalCard`) has NO vertical scroll
wrapper — a tall wrap grid there pushes content (mute toggle, leave/delete) off
screen. A horizontal row never overflows vertically. Don't convert an edit
modal to a wrap grid (or IconPicker's sheet) unless you first give that modal
its own vertical ScrollView.

**Bottom-sheet safety:** IconPicker's "More" sheet follows the ContactSheet
pattern (maxHeight + ScrollView + persistent absolute close X) per the RN modal
overflow trap rule.

**How to apply:** to add/remove icons, edit only `EMOJI_CATEGORIES` (add
keywords for searchability). Onboarding keeps its own smaller `SQUAD_EMOJIS`
(color logic uses `SQUAD_EMOJIS.indexOf(...)`) — intentionally not unified.
