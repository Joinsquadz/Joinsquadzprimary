---
name: Squadz bottom-tab structure
description: Which screens are in the bottom tab bar vs hidden, and where profile/activity live
---

Bottom tab bar (5 visible slots, in order): Home, SquadZ, Events, Messages, Vibe (feed).

**Why:** The Vibe feed spec said "replace the fifth bottom nav slot with a Feed tab" and "remove You from the bottom nav" — so Vibe occupies the LAST slot (where "You" was), not a middle slot. A code reviewer will flag Vibe placed 2nd as a spec miss.

`profile` ("You"), `activity`, and `photos` are hidden tabs — still real routes under `app/(tabs)/`, navigable via `router.navigate("/(tabs)/<name>")`, but not shown in the bar:
- Profile is reached from a top-right avatar button in the Home header (next to the bell), rendered with `ProAvatar isPro={resolveUser(currentUser.id).isPro}` so the gold Pro ring shows.
- Activity is reached from the bell icon in the Home header.

**How to apply:** Two layouts must stay in sync — `NativeTabLayout` (liquid-glass, uses `<NativeTabs.Trigger ... hidden/>`) and `ClassicTabLayout` (uses `tabBarButton: () => null`). Any tab add/remove/reorder must be mirrored in BOTH or the bar differs by device. Hidden tabs have no back stack; users leave them by tapping a visible tab (the tab bar stays on screen).
