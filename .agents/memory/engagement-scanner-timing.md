---
name: Engagement scanner timing source
description: Which machine timestamps event reminder and recap scanners use, and why display dates are only a legacy fallback
---

# Engagement scanner timing source

Event timing for the server engagement scanners (starting-soon reminder and
day-of reminder) must resolve start time from the machine-readable `events.eventAt`
timestamp first, and only fall back to parsing the human-readable `events.date`
display string when `eventAt` is null. Post-plan recaps use a valid `events.endAt`
first so multi-day trips are measured from their actual end, then use the same
start/display fallback for single-instant and legacy events.

**Why:** `parseEventStart` parses the year-less app format ("Sat, Jun 7 · 5:00 PM")
and deliberately rolls any candidate more than ~48h in the past **forward into next
year** (so display strings always read as upcoming). If a scanner computes "time
since the event" from that parsed value, anything older than ~48h looks like it's
~363 days in the future. That makes the recap max-age retirement branch
(`msSince > RECAP_MAX_AGE_MS`) unreachable for real rows: a stale event that never
got marked (e.g. repeated unconfirmed sends) is re-scanned forever and never retires.

**How to apply:** Any new time-window scanner over events must use the appropriate
machine timestamp, never `parseEventStart(event.date)` alone. Candidate SQL and
in-process eligibility must use the same effective timestamp. For recap
"too old / retire" tests, set `endAt` for multi-day trips; otherwise set `eventAt`
to the true past time or use an ISO display date.
