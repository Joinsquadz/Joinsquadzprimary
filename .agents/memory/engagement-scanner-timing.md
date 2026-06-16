---
name: Engagement scanner timing source
description: Why event reminder/recap scanners must read events.eventAt, not parse the year-less display date
---

# Engagement scanner timing source

Event timing for the server engagement scanners (starting-soon reminder, day-of
reminder, post-event recap) must resolve start time from the machine-readable
`events.eventAt` timestamp first, and only fall back to parsing the human-readable
`events.date` display string when `eventAt` is null. A shared `eventStartFor(event, now)`
helper in `eventReminders.ts` encapsulates this.

**Why:** `parseEventStart` parses the year-less app format ("Sat, Jun 7 · 5:00 PM")
and deliberately rolls any candidate more than ~48h in the past **forward into next
year** (so display strings always read as upcoming). If a scanner computes "time
since the event" from that parsed value, anything older than ~48h looks like it's
~363 days in the future. That makes the recap max-age retirement branch
(`msSince > RECAP_MAX_AGE_MS`) unreachable for real rows: a stale event that never
got marked (e.g. repeated unconfirmed sends) is re-scanned forever and never retires.

**How to apply:** Any new time-window scanner over events must use `eventStartFor`
(or `eventAt` directly), never `parseEventStart(event.date)` alone. When writing
tests for the "too old / retire" branches, either set `eventAt` to the true past
time alongside a year-less display `date`, or use an ISO `date` string — a year-less
display string alone cannot express ">48h ago".
