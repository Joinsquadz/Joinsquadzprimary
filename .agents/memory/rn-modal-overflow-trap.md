---
name: RN transparent modal can trap users
description: iOS transparent slide modals have no swipe-dismiss; variable-length content with a bottom-only Close button can push it off-screen and trap the user.
---

A React Native `<Modal transparent animationType="slide">` on iOS has **no swipe-to-dismiss**. The only way out is an on-screen control (or Android hardware back via `onRequestClose`).

**Why:** Squadz's squad member-profile modal rendered profile + shared-squads + "add to another squad" rows in a plain `View` with the Close button at the bottom. With enough rows the content overflowed, the Close button went off-screen, and iOS users were trapped (had to kill the app). The button existed in code — it just wasn't reachable.

**How to apply:** Any bottom-sheet-style modal whose content length is data-dependent must (1) cap height (`maxHeight`), (2) put the body in a `ScrollView`, and (3) give it a PERSISTENT close affordance positioned OUTSIDE the scroll flow (absolute top-right X with zIndex), not just a button at the end of the content. `components/ContactSheet.tsx` is the canonical shared implementation — reuse it for member/contact sheets in both squad and event screens instead of re-inlining a modal.
