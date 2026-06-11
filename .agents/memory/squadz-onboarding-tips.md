---
name: Squadz welcome tips tour
description: How the first-run onboarding coach-mark tour is gated, and why Tip 4 (cost split) anchors to Events.
---

# Welcome tips tour (squadz-native)

A sequential, once-per-user coach-mark tour shown right after onboarding when the
user lands in a squad. Implemented as a root-mounted overlay (`TipCoachMark`) +
`TipsContext` (`armTour`/`maybeStartTour`/`next`/`dismiss`, squad-anchor registry).
Squad-screen tips anchor to measured wrapper Views (`measureInWindow`); Feed-tab
tips are bottom-anchored over the nav. Tour is armed at onboarding completion and
auto-starts on the first squad detail screen.

## Persistence is intentionally OUT of ALL_APP_STORAGE_KEYS
The "seen" flag is a **dynamic** key `tips_seen_<userId>`. It is deliberately NOT
added to `ALL_APP_STORAGE_KEYS`.
**Why:** "show once per user, ever." `logout()` wipes everything in
`ALL_APP_STORAGE_KEYS`; keeping the flag out means it survives logout/login so the
tour never replays. The key is user-id-suffixed, so no cross-account leak on a
shared device. (Arming only happens at onboarding, so even if the flag were
cleared the tour wouldn't re-arm on a normal login — but keeping it persistent is
the explicit contract.)

## Cost splitting has NO squad-screen UI
Cost splitting is **event-scoped**: an event's "Costs" tab (SettleUp/addCost) plus
a net-balances summary on the Home screen. There is no cost-split surface on the
squad detail screen.
**Why:** product decision. The tour's Tip 4 ("split costs") therefore anchors to
the **Events section** of the squad screen with copy that says costs live inside
each event — chosen by the user over a cross-screen hop to Home or dropping the tip.
**How to apply:** don't try to add/anchor cost-split UI on the squad screen; route
users to an event for expenses.

## Known limitation
Native tab-bar slots can't be measured, so Feed-tab tips (5-6) are positioned by
computed geometry (Feed = 5th of 5 tabs, ~width*0.9), approximate on native.
