---
name: Feed/Moments per-ID audience authz
description: Every per-id feed/moment interaction endpoint must re-check audience membership, not just row existence, or it's an IDOR.
---

Feed posts and moments are audience-scoped (`audience` = `"friends"` or a squadId).
The list endpoints (`GET /feed`, `GET /moments/friends`, `GET /moments/squad/:id`)
filter by audience, but the **per-id interaction endpoints** must independently
re-check that the requester is in the post/moment's audience before reading or
writing — existence/`deletedAt` checks alone are not enough.

Endpoints that need the guard: feed `POST :id/reactions`, `GET :id/comments`,
`POST :id/comments`; moments `POST :id/views`, `POST :id/reactions`.

Guards live in the route files: `canViewPost(userId, post)` in `feed.ts`,
`canViewMoment(userId, moment)` in `moments.ts`. Both resolve: author always
true; friends-audience → requester is in author's friends; squad-audience →
requester is a current member of that squad (memberIds `@>`).

**Why:** without the re-check, any authenticated user who knows/guesses a post or
moment id can read comments and write reactions/comments/views across audiences
they're not in — and for moments this also leaks author-side signals (viewer
list, push notifications) for out-of-audience content.

**How to apply:** any NEW per-id endpoint on these tables must call the matching
`canView*` guard right after the existence check. Squad membership is dynamic, so
always re-resolve it per request — never trust an append-only participant row.
