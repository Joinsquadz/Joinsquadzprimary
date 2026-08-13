---
name: Trip poll best-stretch ranking
description: Why trip availability polls rank consecutive runs instead of single days, and the invariants every trip-poll surface must uphold.
---

# Trip polls rank consecutive RUNS, not single days

An availability poll has an explicit type, and a trip poll separately records
how long the trip is. These are two different spans: the voting window is the
range people vote across; the trip length is how long they'd actually be away.

## Rules

- **The stored poll type is authoritative.** Never re-derive it from the
  all-day slot sentinel — that sentinel is only used once, to backfill rows
  created before the type existed.
- **A trip must fit its voting window,** and must be at least 2 days. Reject an
  impossible length rather than clamping it: quietly shortening someone's trip
  is worse than telling them it won't fit.
- **Ranking:** score every consecutive run of the trip length. Primary key is
  how many people are free for *every* day of the run; ties break on the
  earliest start date.
- **Partial fallback:** if no run works for anybody, fall back to total
  person-days and mark the result partial. The UI must say plainly that nobody
  can do the whole stretch.
- **Legacy trip polls never recorded a length** and stay on the older
  single-best-day result. Don't retro-fit them with a length nobody chose.
- **A duration-only change is non-destructive** — it re-ranks but must not trim
  responses or warn about losing them. Date/slot changes still trim.

**Why:** a trip is all-or-nothing. Someone free for two days of a three-day run
cannot go, so person-day totals pick windows nobody can actually attend. The
old single-cell "best day" ranking answered a trip poll with one day, which is
not an answer to "when can we all go away together?".

## Two traps this feature hit

- **Validate the poll's resulting STATE, not the fields the request sent.**
  This bit three separate times, each time because a field was absent rather
  than wrong:
  - a duration-only edit omits the dates (so a huge length slid onto a small
    existing window),
  - a dates-only edit omits the length (so the window shrank under an existing
    trip),
  - a create omits the days entirely — and an unspecified window is filled with
    a *default* range downstream, so "no days in the body" is still a real
    window to measure against, not a reason to skip the check.

  Compare the effective length against the effective days on every write, and
  remember a value applied later in the stack counts as part of the resulting
  state. Legacy (length-less) trips are exempt: there's nothing to outgrow.
- **A "no value yet" state must stay null through the whole edit round-trip.**
  Seeding an editor control with a default so it looks sensible, while
  snapshotting the real (null) value as the dirty-check baseline, means merely
  *opening* the editor reports unsaved changes, Cancel warns about discarding
  work nobody did, and Save writes the invented default — silently opting a
  legacy row into new behavior. Keep null in the control, in the baseline, and
  in the request body (omit the field), and render the empty state as "not set"
  with nothing selected. Only a deliberate user choice may introduce a value.
- **Never fall back to the single-day result on a length-aware trip.** The
  single-cell "best" is still returned for backwards compatibility, so a
  `stretch ?? best` fallback announces ONE DAY as the winner of a multi-day
  trip — even when the stretch is partial. Show the stretch or show nothing,
  on *every* surface: hero, lock-in CTA, empty state, and the creator's
  "you've got a winner" nudge.

**How to apply:** any new trip-poll surface must read the stretch (start **and**
end date) rather than the single cell, and must surface the partial flag rather
than presenting a least-bad window as a win. Keep the result-selection rule in a
shared, unit-tested helper — it is needed in more places than it first appears.

## Kind is asked, never inferred; duration belongs to BOTH kinds

- **Never infer the poll's kind from the entry point.** Screens that launch the
  wizard without a kind must show a Type step, not fall through to "event".
  Inheriting it meant a squad screen could only ever start event polls, and the
  host had no way to say "this is a trip" — the fix is a question, not a better
  default.
- **A loaded poll's stored kind is authoritative.** Route params may only seed a
  NEW poll; they must never override what an existing poll already recorded, or
  reopening a trip poll from the wrong entry point silently converts it.
- **Don't ask again at conversion time.** Once the poll knows its kind, the
  lock-in action follows it. Re-prompting "Event or Trip?" after voting lets a
  stray tap turn a trip poll's result into an event.
- **Duration is a plan property, not a trip property.** The same field carries
  "how long the plan runs" for events too, so a multi-day event ranks by stretch
  and converts with both ends of the winning run prefilled.
- **A one-day plan is expressed as an ABSENT duration,** not `1`. The server
  rejects a length of 1 (no run to rank), and absence is also what keeps single-
  evening events on the single-best-time path. Omit it on create and on PATCH.
