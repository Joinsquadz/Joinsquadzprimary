---
name: Express route shadowing & double /api prefix
description: Two silent 404 classes in api-server — a literal path declared after a matching /:id route, and a router path that repeats the /api mount prefix.
---

# Silent 404s from route registration mistakes

Two distinct mistakes produce endpoints that look implemented, typecheck, pass
unit tests, and still 404 for every real client:

1. **Shadowed literal path.** All routers are mounted under one prefix and
   Express matches in declaration order. A literal path (e.g. a
   `/<resource>/<literal-word>` collection route) declared *after* a
   `/<resource>/:id` route in the same file never runs — `:id` captures the
   literal word, and the id parser then fails/404s. Declare literal segments
   ABOVE the parameterised route in the same file.

2. **Double prefix.** `app.ts` mounts the aggregate router at `/api`. A route
   file that writes its path as `/api/<thing>` therefore serves
   `/api/api/<thing>`. Paths inside route files must be prefix-relative.

**Why:** Both were found only by reading api-server request logs and noticing
404s for paths whose handlers demonstrably exist in the source. Neither had a
route-level test, so the whole suite stayed green.

**How to apply:** When a client call 404s but you can grep the handler, check
these two before assuming the handler is wrong. When adding a collection-style
literal route to a router that already has `/:id`, place it above that route.
Verifying a fix from the container: hit `https://$REPLIT_DEV_DOMAIN/api/...`
with curl and expect **401**, not 404 — 401 proves the route matched and only
auth rejected it.
