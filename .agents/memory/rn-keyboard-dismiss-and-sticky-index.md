---
name: RN keyboard dismissal + sticky header index
description: Why squadz-native has one global keyboard "Done" control, why it must also be mounted inside Modals, and how stickyHeaderIndices depends on direct-child grouping.
---

## Keyboard dismissal is one shared control, not per-input buttons

squadz-native exposes a single reusable keyboard-dismiss affordance mounted at the
root navigator, plus explicitly re-mounted inside every `Modal`/sheet surface that
contains a text input.

**Why:** RN `Modal` creates a separate native presentation layer on iOS — anything
rendered above the root navigator is NOT visible while a modal is up. A single root
mount therefore silently does nothing for modal inputs, which is most of the app's
text entry (expense, poll, edit, settings, availability range, pickers, composers).

**How to apply:** any NEW `Modal`/sheet that contains a `TextInput` must mount the
control INSIDE the modal — the root mount does nothing there. Mount it as the LAST
child of the `Modal`, not the first: RN paints later siblings on top, so a control
placed before the full-screen overlay/backdrop is covered and untappable even though
it renders. Belt-and-braces, the control's own wrapper carries a high
`zIndex`/`elevation` for overlays that set their own stacking. Do not add one-off
"Done" buttons to individual inputs — they drift in style and placement.

Two more constraints baked into the control:
- It returns null on `Platform.OS === "web"`, so the Expo web preview and any web
  screenshot can never verify it. Verification requires a device/simulator.
- iOS needs the measured keyboard height as a bottom offset (root stays behind the
  keyboard); Android generally resizes the window, so offset 0 + safe-area inset.
  Using the iOS math on Android floats the button mid-screen.

## stickyHeaderIndices counts DIRECT children only

A screen that wants exactly one sticky element (e.g. the trip tab selector) must
group everything above it into ONE direct child of the `ScrollView`.

**Why:** `stickyHeaderIndices={[1]}` indexes direct children. If hero/recap/attendee
blocks are separate siblings, index 1 lands on an arbitrary block and content that
should scroll away (avatars, invite control) appears pinned.

**How to apply:** when adding content above a sticky header, add it INSIDE the
existing wrapper view — never as a new sibling — or the sticky index shifts and the
symptom looks like "random content is stuck to the top."
