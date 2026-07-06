---
name: Squad event visibility contract
description: Plain squad events ARE visible to all current squad members (deliberate audit fix); trips' stale-RSVP protections must stay intact.
---

Server access model (events routes, `userCanAccessEvent` + GET /events visibility OR-chain): **both trips and plain squad events are visible to every CURRENT member of their squad**, re-checked live so a removed member loses access immediately. Plain events additionally keep the rsvps-map path so invited outsiders who responded retain access; trips deliberately IGNORE the rsvps map (stale-RSVP trap).

**Why:** the July 2026 audit found (via live simulation) that a squad dinner was invisible to squadmates — 403 on GET/RSVP, absent from their /events list, `goingCount` stuck at 0 — because the old gate was host/RSVP/invite only while the mobile squad screen renders squad events from the member's fetched list. The widening to squad-membership visibility for plain events was a deliberate remediation fix, sim-verified — NOT an accidental authz regression. A later code review mistakenly flagged it as one; do not "fix" it back.

**How to apply:** the contract is locked in by `events.plainEventVisibility.test.ts` (squad member allowed without RSVP; stranger denied; removed member denied; trip stale-RSVP still denied). Any change to `userCanAccessEvent` or the /events list OR-chain must keep those tests green.
