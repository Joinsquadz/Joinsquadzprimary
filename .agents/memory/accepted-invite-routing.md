---
name: Accepted-invite navigation must carry the plan type
description: Why every invite-accept response (200, 409, and the preview) has to report event vs trip, and what breaks when it doesn't.
---

# Accepted invites must route on a server-reported plan type

**Rule:** Any endpoint whose response the client uses to *open a plan* must include the plan
`type` ("event" | "trip"), and the client must route through the shared route helper rather than
hardcoding `/event/:id`. That includes the invite preview, the fresh-join success, and the
"you're already going" 409 — the client treats that 409 as a terminal success, so it needs the
same id + type the 200 carries.

**Why:** Trips and events share one table and one invite-code namespace but have separate detail
screens. When the accept path assumed events, accepting a trip invite opened the event screen and
only corrected itself after the user navigated away and back (the list hydrates the real type on
the next fetch, so it looks like a transient glitch rather than a routing bug — easy to misfile as
a caching problem).

**How to apply:**
- New invite/join/accept response shape → include `type` (default legacy/null rows to "event").
- Client side, never build the path inline; use the accepted-invite route helper so the
  event/trip decision lives in one tested place.
- The same applies to push payloads: a `screen` field chosen from the plan type, not assumed.
- Fallback order on the client: response type → preview type → "event".
