---
name: Squadz welcome tips tour + contextual cost tip
description: How the first-run onboarding coach-mark tour is gated, and why the cost-split tip is a standalone contextual tip on the event screen.
---

# Welcome tips tour (squadz-native)

A sequential, once-per-user coach-mark tour shown right after onboarding when the
user lands in a squad (`TipCoachMark` overlay + `TipsContext`). Squad-screen tips
anchor to measured wrapper Views; Feed-tab tips are bottom-anchored over the nav.
Cost splitting is NOT part of this sequential tour — see below.

## Persistence is intentionally OUT of ALL_APP_STORAGE_KEYS
Both seen flags are dynamic, user-id-suffixed keys (the tour flag and a SEPARATE
cost-tip flag) and are deliberately NOT in `ALL_APP_STORAGE_KEYS`.
**Why:** "show once per user, ever." `logout()` wipes `ALL_APP_STORAGE_KEYS`;
keeping these out means they survive logout/login so tips never replay. Per-user
suffix prevents cross-account leak on a shared device.

## Cost-split tip is standalone + contextual, on the EVENT screen
Cost splitting is event-scoped (an event's "Costs" tab). The cost tip is a SEPARATE
coach mark with its own active/anchor/seen state in `TipsContext`, NOT part of the
sequential tour.
**Why:** product decision — show it in real time on the exact surface where
splitting happens, not in advance on the squad screen. (SUPERSEDES the old "Tip 4
anchors to the squad Events section" approach.)
**How to apply:** it fires when the user opens the event detail screen, anchored to
the measured "Costs" tab chip, and is gated so it never overlaps the sequential
tour. Don't add cost-split UI on the squad screen.

## Two invariants the wiring MUST preserve
- **No stuck invisible state.** The tip goes active before its anchor exists, and
  renders nothing while active-without-anchor. If measuring never completes
  (offscreen chip, fast nav-away, layout race) the context must release the active
  flag on a timeout WITHOUT marking it seen, so it can re-fire later. Don't remove
  that fail-safe.
- **Trigger must be retryable, not one-shot.** The event screen gates its trigger
  on a single context-provided "can show" boolean (seen-flag loaded + unseen + no
  tour in flight + not already active) so it re-attempts the moment the gate opens.
  Don't reintroduce a permanent one-shot `requested` ref guard — it caused missed
  tips when AsyncStorage hadn't resolved or the tour was mid-flight.

## Known limitation
Native tab-bar slots can't be measured, so Feed-tab tips are positioned by computed
geometry, approximate on native.
