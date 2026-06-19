---
name: RN nested-modal pickers
description: How to render DateTimePicker/secondary pickers launched from inside a squadz-native modal sheet without the iOS stacked-modal freeze.
---

# iOS stacked-modal freeze for in-modal pickers

When a picker (e.g. `@react-native-community/datetimepicker` spinner) is launched **from inside an already-open RN `Modal` sheet** (event edit modal, trip "Manage trip" admin sheet), do NOT render that picker as a second `<Modal>`. Stacked RN Modals can freeze/deadlock on iOS.

**Rule:**
- iOS: render the picker as an **in-sheet overlay** — a `View` styled `{ ...StyleSheet.absoluteFillObject, justifyContent: "flex-end", zIndex: 50 }` placed **inside the parent Modal's backdrop View** (sibling to the sheet card), gated on `Platform.OS === "ios"`. It overlays the whole sheet because the backdrop already fills the screen.
- Android: keep the native `DateTimePicker` (`display="default"`) as a **sibling outside** the parent Modal — it's a native dialog and renders over everything regardless of tree position.
- Web: use an inline `<input type="date">` (no picker modal at all).

**Why:** Two simultaneously-visible RN Modals on iOS is the classic freeze pattern; the parent sheet already provides a full-screen backdrop we can host the overlay on, so a nested Modal is unnecessary.

**Exception — reusable screen-level overlays stay Modals:** `components/IconPicker.tsx`'s "More" sheet keeps its `<Modal>` even when used inside other modals. It's a reusable component with no access to a full-screen parent container, so an absolute overlay would be clipped to its small inline footprint. A `Modal` is the correct screen-level overlay tool there; the simple open→pick→close flow with a transparent modal is acceptable.

**Validation invariant for event end time:** an event's `endAt` must be ≥ its start. Enforce BOTH `minimumDate={eventStart}` on the picker AND a submit-time guard (`new Date(editEndAt) < eventStart` → Alert + return). Event start is resolved as `startAt ?? eventAt ?? parseEventStart(event.date)`. `create.tsx` is a screen (not a modal) so its end picker can stay a Modal; it already sets `minimumDate={eventAtISO}`.
