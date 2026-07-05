---
name: Squad plain-event visibility gap
description: Plain events created "in" a squad are NOT visible to squad members; only trips are squad-visible. Client squad screen expects otherwise.
---

Server access model (events routes, `userCanAccessEvent` + GET /events visibility OR-chain): a plain **event** is visible only to host, RSVP'd users, or `invitedUserIds`. Only **trips** are visible to all current squad members. Verified live (July 2026 audit): a squad member gets 403 on GET/RSVP for a squad event and it never appears in their /events list until they join via the invite code or are explicitly invited.

**Why it matters:** the mobile squad screen renders squad events via `events.filter(e => e.squadId === squad.id)` over the client's fetched list — so squadmates see NOTHING for a squad dinner unless the host used the invite-friends picker at creation. `goingCount` stays 0 and the event is undiscoverable in-app. The host-or-RSVP gate is deliberate (stale-RSVP trap protection), but the discoverability gap is a known audit finding (High), deliberately NOT fixed during the audit-only task.

**How to apply:** if asked to "fix squad events not showing", the fix is a visibility decision (e.g. squad-membership visibility for events with a separate RSVP gate), not a client filter bug. Don't "fix" by widening `userCanAccessEvent` blindly — trips' stale-RSVP protections and removed-member revocation must stay intact.
