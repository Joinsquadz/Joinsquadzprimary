---
name: api-server route double-/api prefix trap
description: The index router is mounted at /api, so route paths must NOT include their own /api prefix or they end up at /api/api/...
---

In `artifacts/api-server`, `app.ts` mounts the aggregate router with `app.use("/api", router)`. Express strips the `/api` mount prefix before matching, so **every route inside a sub-router must be declared WITHOUT a leading `/api`**.

- Correct: `router.get("/users/by-friend-code/:code", ...)` → reachable at `/api/users/by-friend-code/:code`.
- Wrong: `router.get("/api/users", ...)` → reachable only at `/api/api/users`, so the client calling `/api/users` gets a 404.

**Why:** `users.ts` historically mixed both styles; `/api/users` (by-ids, used by UserCacheContext) and `/api/users/search` were silently unreachable while `/users/by-friend-code` worked.

**How to apply:** Declare new routes relative to the mount (no `/api`). Verify reachability by curling through the proxy (`localhost:80/api/...`): a 401 means the route exists (auth gate hit), a 404 means the path/prefix is wrong.
