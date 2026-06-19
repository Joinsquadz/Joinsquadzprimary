---
name: RN stacked Modals freeze iOS
description: Presenting a second RN Modal while one is already open freezes the iOS UI; render secondary pickers/sheets as in-sheet overlays instead.
---

Rendering a second `<Modal>` (e.g. a time/date picker) while another `<Modal>`
(a bottom sheet) is already visible **freezes the UI on iOS**: the second modal
often never appears ("nothing opens") and touch handling deadlocks afterward.

**Why:** iOS can only reliably present one RN `Modal` at a time. A sibling Modal
mounted concurrently competes for the presentation context — the symptom is
exactly "tapping does nothing, then the app freezes."

**How to apply:** When a component is itself a `Modal` (a bottom sheet) and needs
a secondary picker, do NOT add a second `Modal`. Render the picker as an
absolutely-positioned overlay (`absoluteFill` backdrop `TouchableOpacity` + the
picker sheet) *inside* the existing Modal's view tree. Android's date/time picker
with `display="default"` is a native dialog (not a JS Modal), so it's safe to
mount inline. A full-screen-route component (not a Modal itself) CAN open a real
Modal picker — the freeze only happens when two Modals overlap.

**Related gotcha (bottom-sheet pickers + keyboard):** a bottom-anchored picker
overlay renders *behind* a raised software keyboard, so it looks like "nothing
opens." If the sheet autofocuses a text field (e.g. `autoFocus` on the title in
"add/create" mode but not "edit" mode), call `Keyboard.dismiss()` when opening
the picker. Symptom signature: picker works when editing (no autofocus) but not
when adding (autofocus on).
