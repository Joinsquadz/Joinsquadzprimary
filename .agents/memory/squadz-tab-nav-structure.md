---
name: Squadz bottom-tab structure
description: Which screens are in the bottom tab bar vs hidden, and where profile/activity live
---

Bottom tab bar (5 visible slots, in order): Home, SquadZ, Events, Messages, Vibe (feed).

**Why:** The Vibe feed spec said "replace the fifth bottom nav slot with a Feed tab" and "remove You from the bottom nav" — so Vibe occupies the LAST slot (where "You" was), not a middle slot. A code reviewer will flag Vibe placed 2nd as a spec miss.

`activity` and `photos` are hidden tabs (real routes under `app/(tabs)/`, not shown in the bar). `activity` is reached from the bell icon in the Home header.

**Profile ("You") is a ROOT STACK route** (`app/profile.tsx`), NOT a hidden tab. It is reached via `router.push("/profile")` from a top-right avatar button in the Home header (next to the bell, `ProAvatar isPro={resolveUser(currentUser.id).isPro}` for the gold ring) and from the Vibe feed header. It was originally added as a hidden tab and that broke: hidden-tab navigation no-ops on native (see `squadz-native-routing.md`), so the profile button "couldn't be opened". The fix was to promote it to a root Stack route + add a chevron-back header (root Stack screens have no tab bar). Registered in `app/_layout.tsx` as `<Stack.Screen name="profile" />`.

**How to apply:** Two VISIBLE-tab layouts must stay in sync — `NativeTabLayout` (liquid-glass, `<NativeTabs.Trigger>`) and `ClassicTabLayout` (`<Tabs.Screen>`). Any tab add/remove/reorder must be mirrored in BOTH or the bar differs by device. Any screen reached imperatively from multiple places should be a root Stack route, never a hidden tab.
