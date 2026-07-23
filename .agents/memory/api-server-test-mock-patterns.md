---
name: api-server test mock patterns
description: Gotchas for mocking @workspace/db and route-level modules in api-server vitest tests
---

## Chainable thenable db mock

When a route chains `.from().where().orderBy()` (or any multi-step chain after `.from()`), `.where()` must return a chainable object — not a bare `Promise`. Use this helper:

```ts
function makeChainable(getValue: () => unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    where: (..._: unknown[]) => makeChainable(getValue),
    orderBy: (..._: unknown[]) => makeChainable(getValue),
    limit: (..._: unknown[]) => makeChainable(getValue),
    offset: (..._: unknown[]) => makeChainable(getValue),
    leftJoin: (..._: unknown[]) => makeChainable(getValue),
    innerJoin: (..._: unknown[]) => makeChainable(getValue),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(getValue()).then(res, rej),
  };
  return self;
}
// Usage: db: { select: () => ({ from: () => makeChainable(() => mockRows.value) }) }
```

**Why:** GET /api/events and GET /api/feed both chain `.where(...).orderBy(...)`. Simple `from: () => ({ where: () => Promise.resolve(rows) })` breaks the chain because a Promise has no `.orderBy()`.

## Route moderation import path

`getBlockedAndBlockerIds` is imported by `conversations.ts` as `from "./moderation"` (same routes dir). Mock path in tests must be `"../routes/moderation"`, NOT `"../lib/moderation"`.

**Why:** vi.mock resolves relative to the test file, not the source file. The import in conversations.ts is `./moderation` (→ `src/routes/moderation.ts`). From `src/__tests__/`, that resolves to `"../routes/moderation"`.

## conversationUpdates mock required for POST /conversations/:id/messages

`conversations.ts` imports `emitConversationUpdate from "../lib/conversationUpdates"`. Any test that exercises the message-send path (201) MUST mock this:

```ts
vi.mock("../lib/conversationUpdates", () => ({
  emitConversationUpdate: vi.fn(),
  onConversationUpdate: vi.fn().mockReturnValue(() => {}),
}));
```

Without this, the 201 path throws "emitConversationUpdate is not a function".

## Auth tests: force DB code-path by mocking supabase

When `SUPABASE_URL` is set in the Replit environment, `supabaseAdmin` is non-null at import time. Auth routes check `if (supabaseAdmin && supabaseAuth)` and take the Supabase Admin API path instead of the DB path. Mock the clients to null to force the DB path:

```ts
vi.mock("../services/supabase", () => ({ supabaseAdmin: null, supabaseAuth: null }));
```

**Why:** In tests, env vars from the Replit secrets are present, making `supabaseAdmin` non-null. The DB-path tests expect specific mock behaviors that the Supabase path bypasses.

## Auth register: SELECT-based 409, not INSERT-catch

The auth register route checks email existence with a SELECT before INSERT. The 409 is returned if `[existing]` is truthy (SELECT returns a row). There is NO try-catch around the INSERT for 23505 in the DB path. Tests for "duplicate email" must set `dbMock.selectRows = [{id: "..."}]`, not simulate an INSERT constraint error. Also: the success path uses `res.json()` (200), NOT `res.status(201)`.

## Account deletion: tx.execute + many table mocks

`DELETE /api/account` uses `tx.execute(sql\`DELETE FROM sessions...\`)` for session cleanup. The transaction mock MUST include `execute: vi.fn().mockResolvedValue(undefined)`. The route also accesses many tables whose column properties are dereferenced at call time — if a table is missing from the mock, `undefined.columnName` throws → 500. Required tables: `conversationMessagesTable` (senderId, conversationId, createdAt, text), `feedReactionsTable` (userId), `feedCommentsTable` (authorId), `momentViewsTable` (viewerId), `momentReactionsTable` (userId), `availabilityNudgesTable` (fromUserId, toUserId), `friendshipsTable` (ownerId, friendId), `squadRemovalNoticesTable` (userId), `objectUploadsTable` (ownerId).

## Moments router is separate from feed router

`DELETE /api/moments/:id` is defined in `moments.ts` (separate router), NOT in `feed.ts`. Tests for moments moderation must import `momentsRouter from "../routes/moments"` and use it — using `feedRouter` returns 404 for moments routes.
