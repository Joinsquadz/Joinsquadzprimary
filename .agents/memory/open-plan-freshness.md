---
name: Open plan detail freshness (RSVPs / guest list)
description: Why an open event screen must refetch the single plan and key its user prefetch on the roster, not on the plan id
---

An open plan detail screen has TWO freshness dependencies, and both must be
satisfied or a change made by someone else is invisible until the app is
relaunched:

1. **Refetch the single plan, not the list.** `refreshEvents()` reloads
   `GET /api/events`, which is paginated (default 100) and upcoming-only. A plan
   that falls outside that page — and every past plan, which lives only in the
   screen-local fallback state — is never replaced by a list refresh, so SSE
   updates and the safety-net poll appear to do nothing. The detail screen needs
   a single-record path (`GET /api/events/:id`) that replaces the cached record
   AND the screen-local fallback.

2. **Key the user-profile prefetch on the roster, not on the plan id.** Names and
   avatars are resolved through a lazily-populated user cache. Prefetching with
   a `[event.id]` dep array runs exactly once per mount, so anyone who joins
   while the screen is open is never fetched — they render as a `...`
   placeholder, or the row appears only after a remount. Derive a sorted
   primitive key over host + RSVP keys + invited ids + assignees + payers.

**Why:** Reported as "guests don't populate on the host screen — I only see them
after closing and reopening the app", while the Guests view itself was correct.
The server, the SSE emit, and the authz were all fine; the client was refreshing
a list that did not contain the record it was displaying.

**How to apply:** Any detail screen fed by a paginated list cache. The roster key
must be sorted and value-based so it does not churn on every render (an unstable
key re-runs the fetch continuously — see refetch-flicker-object-deps).

Related: SSE frame parsing should split on `/\r?\n\r?\n/`, since a proxy that
normalizes line endings would otherwise make every update frame unparseable.
