---
name: vitest v4 strict named-import throws
description: vitest v4 throws at runtime (not import time) when a named import is absent from a vi.mock factory — even if the code has a null guard. Guard binding access in a try-catch in library code that must degrade silently.
---

## The Rule

In **vitest v4**, if a test calls `vi.mock("some-pkg", () => ({ ... }))` and that mock omits a named export (e.g. `pool`), accessing the binding in production code at **runtime** throws:

```
[vitest] No "pool" export is defined on the "@workspace/db" mock.
Did you forget to return it from "vi.mock"?
```

This throw happens **lazily** (at first access of the binding), not at module-load time. This means:
- The module loads fine
- The route returns 200 (response sent before the throw)
- Code after the throwing line never runs — including fire-and-forget IIFEs
- Tests using `vi.waitFor(() => expect(push).toHaveBeenCalled())` time out silently

**Why:** vitest v4 intentionally validates named imports against the factory's return value. Older versions returned `undefined`; v4 throws as a strict lint check.

## How to Apply

**In library code that must degrade silently** (like `pgPubSub.pgNotify`), wrap the binding access:

```ts
let p: typeof pool;
try {
  p = pool; // vitest v4 throws here if pool absent from vi.mock factory
} catch {
  return; // degrade silently — same as a failed pool query
}
if (!p) return;
```

**In test code**, the clean fix is to add the missing export to the vi.mock factory:
```ts
vi.mock("@workspace/db", () => ({
  db: { ... },
  pool: undefined, // ← add this when pool is imported transitively
  eventsTable: { ... },
}));
```

**Avoid:** updating 65+ test files when the library itself can guard. Prefer one fix in the library over many test-file updates.

## Affected in this project

`pgPubSub.ts` imports `pool` from `@workspace/db`. Any test that:
1. Mocks `@workspace/db` without exporting `pool`
2. Tests a route that calls `emitEventUpdate()`/`emitSquadUpdate()` (which call `pgNotify`)

…will have the push IIFE silently skipped, causing `vi.waitFor(push.toHaveBeenCalled)` tests to time out.

**Fixed by:** wrapping `pool` access in try-catch inside `pgNotify`.
