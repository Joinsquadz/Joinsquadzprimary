---
name: User-pair relationship locking
description: Concurrency and privacy rule for friend requests, direct plan invites, acceptance, and blocking.
---

All relationship mutations between two users must acquire the same canonical unordered-pair transaction lock, then recheck mutual blocks before writing. Blocking must invalidate pending requests/invites and revoke accepted direct-plan access, while leaving independent squad membership and RSVP state unchanged.

**Why:** Directional uniqueness alone permits crossed pending requests, and independent prechecks allow a concurrent block to race with an invite or acceptance. Accepted direct invites also remain an authorization edge unless removed when either party blocks the other.

**How to apply:** Use the shared pair-lock helper for any new friend, direct-invite, acceptance, or block mutation. Keep writes transactional, notify only true state transitions, and filter blocked relationships from pending-read surfaces.