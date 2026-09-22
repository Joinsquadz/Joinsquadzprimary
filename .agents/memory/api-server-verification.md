---
name: api-server verification
description: How to verify the api-server artifact and avoid dev-server/test workflow contention.
---

# Verifying `@workspace/api-server`

Run both `pnpm --filter @workspace/api-server run typecheck` and the unit test suite. The
standalone typecheck currently succeeds; an older `vitest.config.ts`/`rootDir` failure is no
longer the baseline and should not be ignored if it returns.

**Real-DB concurrency suite:** `pnpm --filter @workspace/api-server run test:concurrency` boots a
throwaway local Postgres and is separate from the unit suite. The current baseline is green.

**Also:** the running dev API server does NOT always hot-pick newly added routes. After adding a
route, restart the `artifacts/api-server: API Server` workflow, then a curl to the new path returns
401 (auth) rather than "Cannot POST" if it's correctly registered.

Do not restart the API workflow while the full `api-server-tests` workflow is still running. Their
combined worker/build load can make the dev server's `thread-stream` worker exit even when the code
and tests are healthy. Wait for tests to finish, then restart the API once.
