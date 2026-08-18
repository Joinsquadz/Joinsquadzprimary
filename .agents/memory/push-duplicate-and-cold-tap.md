---
name: Duplicate pushes & cold-start notification taps
description: The two opposite failure modes of push delivery (same alert twice / alert silently lost) and the invariants that prevent both.
---

# Duplicate alerts: dedupe at every widening boundary

A single plan can reach one person through several independent producers. Each
is correct in isolation, so duplicates only appear in production.

Rule: whenever a recipient set is built from **two sources that can overlap**,
subtract the already-notified set — do not rely on a downstream filter.

Direct invitees and squad fan-out overlap constantly (you invite a friend who is
also in the squad). Dedupe recipient IDs *and* dedupe device tokens at the final
send boundary — these are different boundaries, because one person can reach the
same device through two different id paths. Recipient rows grouped by timezone
can also repeat a device; a device cannot be in two zones.

**Why:** users reported two identical trip notifications arriving together.

## Fire-once claims cut both ways

Reminder/recap/nudge scanners use an atomic claim so only one replica sends. The
dangerous state is a send the provider **partially** accepts:

- Release the claim → the next scan re-alerts everyone, including the devices
  already notified. Duplicate alerts.
- Keep the claim and do nothing → the failed devices are never notified. Silent
  delivery loss, which is just as bad and much harder to notice.

**The rule:** retry at the granularity of the failure, and make that retry
durable. An in-process retry that discards its own failures is not a fix — it
just narrows the window in which notifications are lost. Devices the provider
rejected must be persisted as owed deliveries (scoped to the notification that
produced them, unique per device so re-enqueueing can't stack alerts) and
retried by a worker until they succeed, the device is unregistered, or an
attempt ceiling is hit. Only a send accepted by *nobody* may release the claim.

Permanently-dead device tokens are never retried — they're dropped.

**How to apply:** any new fire-once push producer. "okCount > 0 so we're done"
is wrong whenever partial failure is possible.

# Cold-start notification taps

A push can launch the process from a fully-killed state. Two things break:

1. **Routing before auth is restored.** The detail screen fetches the plan with
    missing or stale credentials, fails, and shows its generic "couldn't load"
    state — for a plan the user can actually access. Queue the validated payload
    and route only once the session is usable. Queue in arrival order, not a
    single slot: two notifications arriving together otherwise overwrite each
    other and only the last tap survives. Drain one item per completed navigation
    interaction; issuing every stack route in one render still makes transitions
    compete and leaves an arbitrary destination on top.
2. **Raw fetch in detail screens.** Cold fallback fetches must use the shared
   authenticated fetch wrapper, which serializes token refresh and distinguishes
   a confirmed-expired session from a transient failure.

Notification payloads are external input: forward only string-valued keys to
routing, and treat a malformed payload as "no route" rather than casting it.

**Why:** a valid trip showed "Couldn't load this trip" when opened from a
notification, while opening fine from inside the app.

# Permission prompts: only the user may be sent to Settings

Once notification permission is permanently denied, the OS never shows the
prompt again, so re-requesting is a silent no-op and any "Fix" affordance
appears broken. Settings is the only real remedy — but opening it from an
automatic startup check yanks the user out of the app uninvited.

**The rule:** an automatic permission check may only surface the banner; only a
user-initiated tap may open Settings. Keep the decision in one pure helper so
both paths stay testable and can't drift apart.
