---
name: Scheduler-locked scan passes
description: All periodic notification producers must run inside the cross-instance scheduler lock pass, not their own bare setInterval.
---

Periodic notification producers (engagement scans, owed push-retry drain) run under a Postgres advisory scheduler lock so exactly one API replica performs each pass per tick; per-item atomic claims remain as defence in depth.

**Why:** every replica starts the same interval timers; any future scanner that forgets the claim pattern would double-send the moment the app runs on more than one instance.

**How to apply:** add any new periodic notification producer inside the existing locked pass (see lib/schedulerLock.ts and its callers), or wrap it with the lock helper using a fresh, non-colliding advisory key — never a bare setInterval. Grep for existing `pg_advisory` keys before choosing a new one.
