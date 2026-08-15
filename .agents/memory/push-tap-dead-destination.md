---
name: Push taps must land on a screen the recipient can already open
description: Why invite pushes spun forever, and the two rules every new push payload has to satisfy
---

**Rule:** a push `data.screen` must point at a screen the RECIPIENT can load *at
the moment the push is sent*, and the client's fetch must treat an authenticated
refusal (403/404) as terminal.

Two independent bugs have to both be right, or a tap dead-ends on a spinner:

1. **Destination must match current access.** A *pending* plan invite grants no
   access until it is accepted — the plan GET answers 403 — so its push must go
   to Activity (where Accept lives), not the plan detail screen. Invites written
   straight into `invitedUserIds` (create-time) DO have access and go to the plan.
   Same trap shape for anything gated on acceptance/approval.
2. **403/404 must resolve, not retry.** The shared auth-race guard was built for
   a cold-start 401 (token not restored → keep loading + retry). Its `failure`
   outcome is deliberately a NO-OP outside a pending race, so a first-fetch 403
   left the screen pending forever. There is now a `denied` outcome that ends the
   race in the error state; detail fetches must map 403/404 to `denied`.

**Why:** users reported "tapping the invite notification opens a blank page with
a loading circle that never loads". Neither half was visible in logs — the API
answered correctly (403) and the client never errored, it just waited.

**How to apply:** for every new push/activity type ask (a) can the recipient open
this destination *right now*, and (b) does the destination's fetch resolve on
403/404. Also: pick the screen by plan type (`trip` vs `event` are separate
routes) and check the tab name exists on that screen — the trip media tab is
`vault`, the event one is `photos`; a wrong tab silently falls back to the
default. A payload whose `screen` has no client case (e.g. `squads`) does nothing
at all.
