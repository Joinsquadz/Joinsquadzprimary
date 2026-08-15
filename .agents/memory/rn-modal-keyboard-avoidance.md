---
name: RN Modal keyboard avoidance
description: Why screen-level keyboard avoidance never fixes an input inside a React Native Modal, and the shared wrappers Squadz uses instead.
---

A React Native `Modal` renders in its **own native window**. Any keyboard
avoidance applied at the screen level (a `KeyboardAvoidingView` or
`KeyboardAwareScrollView` wrapping the screen) has **zero** effect on modal
content. A bottom-anchored sheet stays pinned to the bottom of the display and
the keyboard covers exactly the field being typed into.

**The rule:** every `Modal` that contains a `TextInput` needs its OWN keyboard
avoidance, applied at the overlay/backdrop root — not at the screen.

**Why:** this is invisible in the web preview (react-native-web lays modals out
inline, so they look fine) and invisible on a simulator with a hardware
keyboard attached. It only reproduces on a physical device with the software
keyboard up, which is why input modals kept shipping broken.

**How to apply (Squadz):**
- Modal/sheet surfaces: wrap the overlay in `components/KeyboardAvoidingSheet`
  (iOS `behavior="padding"`, Android `"height"`, plain `View` on web) instead of
  a hand-rolled `KeyboardAvoidingView`. A hand-rolled one with
  `behavior={ios ? "padding" : undefined}` is a **no-op on Android** — that
  pattern is the bug, not a fix.
- Full-screen form surfaces: `components/KeyboardAwareScrollViewCompat`.
- Virtualized lists with inline inputs (the feed composer / comment boxes):
  a `FlatList` scrolls its own content, so wrapping it does nothing — it has to
  BE the aware scroller via `renderScrollComponent={renderKeyboardAwareScroll}`.

**The companion trap:** the wrapper only helps if the sheet can actually
shrink. A fixed pixel `maxHeight` (e.g. `maxHeight: 420`) cannot, so the sheet's
top gets pushed off-screen once the keyboard is up and the header/close control
becomes unreachable. Use a percentage `maxHeight` on the card plus
`flexShrink: 1` on its scroll area.

`KeyboardDismissControl` must remain the LAST child of the `Modal` (sibling of
the wrapper, not inside it), or the Done button renders behind the sheet.
