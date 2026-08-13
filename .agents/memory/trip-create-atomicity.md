---
name: Trip creation is one atomic write
description: Why trip date range + template itinerary + poll claim all go in the single POST /events request, and how a trip's start date is resolved.
---

# Trip creation is one atomic write

A trip must be COMPLETE the moment it is created: date range, poll claim, event
creation ledger row, and any template itinerary stops all land in the same
create transaction. Template stops are sent as an `initialItinerary` array on
the create request — never added afterwards with a loop of add-stop calls.

**Why:** post-create stop calls can partially fail, leaving a trip with half an
itinerary (or none) that the user has to rebuild by hand, and they run outside
the transaction that makes the poll conversion exactly-once. The poll claim
(stamp `converted_event_id` only while NULL, inside the create txn) is the only
thing preventing two "lock in this time" taps from producing duplicate plans;
anything done after the insert can't participate in that guarantee.

**How to apply:**
- The server, not the client, assigns stop ids, `createdBy`, `status`, `votes`,
  and per-day `sortOrder` (ordering restarts at 0 for each day).
- Reject an itinerary on a non-trip; reject an inverted range.
- A trip's start can arrive as `startAt` OR as `eventAt` (callers that only set
  a single time). Resolve `startAt ?? eventAt` before validating "a trip needs a
  start date" — validating `startAt` alone rejects legitimate trip creates.
- A missing `endAt` normalizes to the start (one-day trip), so every trip has a
  range and range-aware expiry/rendering always has a value.
- Template length is a suggestion: stops whose materialized day falls past the
  user's chosen end date are filtered out client-side before sending.
- Trip day rendering derives from `startAt`/`endAt`, so every inclusive day
  shows even with zero stops; the "dates needed" empty state is only for a trip
  with no derived day keys at all.
