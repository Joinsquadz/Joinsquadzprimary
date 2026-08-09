---
name: api-server verification
description: How to correctly verify the api-server artifact; why its standalone typecheck is misleading.
---

# Verifying `@workspace/api-server`

`pnpm --filter @workspace/api-server run typecheck` (`tsc -p tsconfig.json --noEmit`) emits a
pre-existing error: `vitest.config.ts is not under rootDir 'src'` (TS6059). This is NOT caused by
route/source changes — `tsconfig.json` `include`s `vitest.config.ts` while `rootDir` is `src`.

**How to apply:** To verify api-server changes, run the test suite instead:
`pnpm --filter @workspace/api-server run test` (vitest compiles+runs the TS). Don't chase the
vitest.config rootDir error when validating source edits — it's orthogonal.

**Real-DB concurrency suite:** `pnpm --filter @workspace/api-server run test:concurrency` boots a
throwaway local Postgres and is separate from the unit suite. It has known-failing sections that are
NOT caused by your change (concurrent cost adds and concurrent poll votes both expect 1 success /
N-1 conflicts and currently get 0 successes). Establish the baseline before debugging: `git stash`,
re-run, compare, `git stash pop`. Don't assume a red test in this suite is yours.

**Also:** the running dev API server does NOT always hot-pick newly added routes. After adding a
route, restart the `artifacts/api-server: API Server` workflow, then a curl to the new path returns
401 (auth) rather than "Cannot POST" if it's correctly registered.
