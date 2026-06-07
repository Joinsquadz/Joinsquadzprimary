---
name: Squadz web tab bar overlays bottom buttons
description: Why fixed bottom action buttons are unclickable on the Expo web preview
---

In `artifacts/squadz-native/app/(tabs)/_layout.tsx` the classic web tab bar is `position: "absolute"` with `height: 84` on web. Because it's absolute, it does NOT reserve flex space — it **overlays** the bottom of every screen.

**Consequence:** any screen with a fixed bottom action bar (e.g. the "Create Event" button in `app/(tabs)/create.tsx`) must reserve `TAB_BAR_HEIGHT` of bottom padding, or the button sits *under* the tab bar and is unclickable on web. This presented as "events still not working" — navigation reached the form, but the submit button couldn't be pressed.

**Rule:** the tab bar height is single-sourced in `constants/layout.ts` (`TAB_BAR_HEIGHT`, web = 84). Both `_layout.tsx` and any screen reserving bottom space import it. Never hard-code a different tab-bar height in a screen — a mismatch silently hides the button on web.

**Note on hidden tabs:** `create`/`events`/`photos` are hidden tabs (`tabBarButton: () => null` classic; `<NativeTabs.Trigger ... hidden />` native). The tab bar still renders (for the visible tabs) while you're on a hidden screen, so the overlay still applies there. Navigate to hidden tabs with `router.navigate` (not `router.push`, which no-ops on hidden tabs).
