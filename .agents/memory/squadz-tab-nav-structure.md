---
name: Squadz bottom-tab structure
description: Which screens are in the bottom tab bar vs hidden, and where profile/activity live
---

Bottom tab bar (5 visible slots, in order): Home, SquadZ, Events, Messages, Vibe (feed).

**Why:** The Vibe feed spec said "replace the fifth bottom nav slot with a Feed tab" and "remove You from the bottom nav" — so Vibe occupies the LAST slot (where "You" was), not a middle slot. A code reviewer will flag Vibe placed 2nd as a spec miss.

`photos` is the only hidden tab (real route under `app/(tabs)/`, not shown in the bar, navigated imperatively).

**Both Profile ("You") and Activity (the notifications "bell") are ROOT STACK routes** (`app/profile.tsx`, `app/activity.tsx`), NOT hidden tabs. Reached via `router.push("/profile")` / `router.push("/activity")` from the two top-right Home-header buttons (avatar + bell). Both have a back header (`canGoBack() ? back() : replace("/(tabs)")`).

**Why:** hidden-tab navigation is unreliable (no-ops on native, flaky on react-native-web — see `squadz-native-routing.md`), so a header button targeting a hidden tab "can't be opened" / "isn't clickable". The proven fix is to promote the destination to a root Stack route + add a back header (root Stack screens have no tab bar) and register `<Stack.Screen name="…" />` in `app/_layout.tsx`. Profile hit this first; Activity/bell was migrated the same way for the same reason.

**How to apply:** any screen reached imperatively from a header/button (not the bottom bar) should be a root Stack route, never a hidden tab. The two VISIBLE-tab layouts must stay in sync — `NativeTabLayout` (liquid-glass, `<NativeTabs.Trigger>`) and `ClassicTabLayout` (`<Tabs.Screen>`); any tab add/remove/reorder must be mirrored in BOTH or the bar differs by device.
