---
name: react-native-web Alert is a no-op
description: Why alert-driven buttons appear dead in the Squadz mobile web preview, and how it's fixed
---

# react-native-web does not implement `Alert.alert`

In `artifacts/squadz-native` (Expo), `Alert.alert(...)` silently does nothing when the app runs on **web** (react-native-web). It works fine on native iOS/Android. Since the user reviews the app through the **web preview** (canvas iframe / Expo web), every alert-driven action — confirmations, "are you sure", info dialogs, resend-code, sign-out, approve/decline, friend add/remove, Help & Support — looked like a dead button even though the code was correct.

**Why:** This is a known RN-Web quirk, not derivable from reading the app code; nothing logs an obvious error.

**How it's fixed:** `lib/webAlert.ts` exports `installWebAlert()`, called once at the top of `app/_layout.tsx`. It mutates `Alert.alert` **only when `Platform.OS === "web"`** (native untouched), mapping native alert buttons onto `window.alert` / `window.confirm`:
- 0–1 buttons → `window.alert`, then run the button's `onPress`.
- 2 buttons → `window.confirm`: OK = last non-cancel (affirmative), Cancel = the cancel-styled-or-first button. (e.g. `[Cancel, Sign Out]` → OK signs out; `[Decline, Approve]` → OK approves.)
- 3+ buttons → can't fit `confirm`; show the message + a `[choice · choice]` list and only fire a `style:"cancel"` handler — **never auto-fire a navigation/action button** (avoids wrong-action bugs like the 4-button Pro alert always triggering "Calendar Sync").

**How to apply:** If you add a flow that depends on `Alert.alert` and need it usable in the web preview, this shim already covers it. Don't "fix" a seemingly-dead alert button by rewriting the screen — the logic is usually fine; it's the web Alert no-op. For true multi-choice menus that must work on web, build a real in-app modal instead of relying on a >2-button `Alert`.
