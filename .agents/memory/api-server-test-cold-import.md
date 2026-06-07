---
name: api-server test cold-import flakiness
description: Why api-server router/middleware tests must hoist module loading to collection time instead of importing inside timed hooks.
---

# Cold dependency-graph transform must stay out of the timed test window

In `artifacts/api-server/src/__tests__`, router/middleware access-control tests
previously loaded the unit under test with `await import("../routes/X")` inside a
per-test `makeApp()` helper (or `await import("../storage")` inside `beforeEach`,
or `vi.resetModules()` + dynamic import). That puts a one-time, heavy transform of
the real dependency graph (`@workspace/db/schema` -> drizzle-orm, or
`openid-client`) inside vitest's 5s per-test / 10s hook timeout. Under parallel
CPU/transform contention it tips over and flakes.

**Rule:** import the router/middleware (and any mocked module you reference) as a
**static top-level import placed BELOW the `vi.mock(...)` calls**. `vi.mock` is
hoisted above all imports, so the static import still resolves against the mock,
but the transform now happens at collection time (untimed). Make `makeApp`
synchronous; `await makeApp()` at call sites is harmless on a non-promise.

**Why:** the transform cost is real work that must happen somewhere; only the
timed window is dangerous. Hoisting moves it to collection where there is no
timeout. Raising timeouts is a band-aid and was explicitly disallowed.

**How to apply:** any new api-server test that builds an express app from a real
router/middleware should follow this shape (reference:
`storage.addPhoto.provenance.test.ts`). Mocks that read `vi.hoisted` refs
dynamically per request do NOT need `vi.resetModules()` between cases.
