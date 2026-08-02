import { describe, it, expect, vi, beforeEach } from "vitest";

// Unit tests for reconcileFoundingCounter.
//
// Scenarios covered:
//   R1 — already in sync (no-op)
//   R2 — counter drift without legacy Stripe data (counter corrected)
//   R3 — legacy back-fill from stripe.checkout_sessions, then counter set
//   R4 — stripe.checkout_sessions unavailable, ledger already correct (no-op)
//   R5 — stripe.checkout_sessions unavailable, counter still corrected from ledger
//   R6 — counter greater than ledger (over-count) is corrected downward

// ---------------------------------------------------------------------------
// Chainable thenable mock helper (see api-server-test-mock-patterns memory)
// ---------------------------------------------------------------------------

function makeChainable(getValue: () => unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    where: (..._args: unknown[]) => makeChainable(getValue),
    orderBy: (..._args: unknown[]) => makeChainable(getValue),
    limit: (..._args: unknown[]) => makeChainable(getValue),
    then: (
      resolve: (v: unknown) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(getValue()).then(resolve, reject),
  };
  return self;
}

// ---------------------------------------------------------------------------
// Hoisted mock state — all vi.mock calls must see these before any import
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  // Queue of results for successive tx.select().from(…) calls.
  const selectQueue: Array<unknown[]> = [];

  // Controls the second tx.execute call (the stripe.checkout_sessions backfill).
  // If set to an Error, that call rejects; otherwise it resolves.
  let backfillError: Error | null = null;

  const insertResult = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  // Tracks the last value passed to insert().values() for assertion.
  let lastInsertValues: unknown = null;
  insertResult.values.mockImplementation((v: unknown) => {
    lastInsertValues = v;
    return insertResult;
  });

  const loggerMock = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    selectQueue,
    insertResult,
    loggerMock,
    get lastInsertValues() { return lastInsertValues; },
    set lastInsertValues(v: unknown) { lastInsertValues = v; },
    get backfillError() { return backfillError; },
    set backfillError(e: Error | null) { backfillError = e; },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../lib/logger", () => ({ logger: hoisted.loggerMock }));

vi.mock("@workspace/db/schema", () => ({
  foundingMemberCounterTable: { id: "fmc_id_col" },
  foundingMemberRedemptionsTable: { subscriptionId: "fmr_sub_col" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const real = await importOriginal<typeof import("drizzle-orm")>();
  return { ...real, eq: vi.fn(() => "eq_expr") };
});

vi.mock("@workspace/db", () => {
  // Build a fresh tx-like mock that uses hoisted queues at call time.
  function makeTx() {
    let executeCallCount = 0;
    let selectCallCount = 0;

    return {
      execute: vi.fn(async () => {
        executeCallCount++;
        // Call 1 = advisory lock → always resolves.
        // Call 2 = backfill INSERT → honours backfillError.
        if (executeCallCount === 2 && hoisted.backfillError) {
          throw hoisted.backfillError;
        }
        return { rows: [] };
      }),
      select: vi.fn(() => {
        const index = selectCallCount++;
        return {
          from: () => makeChainable(() => hoisted.selectQueue[index] ?? []),
        };
      }),
      insert: vi.fn(() => hoisted.insertResult),
    };
  }

  const tx = makeTx();
  const db = {
    ...tx,
    // transaction() calls the callback with a fresh copy of the same mock.
    transaction: vi.fn((cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
      cb(makeTx()),
    ),
  };

  return { db };
});

// ---------------------------------------------------------------------------
// Import the function under test AFTER all mocks are set up
// ---------------------------------------------------------------------------

import { reconcileFoundingCounter } from "../lib/founding";

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.selectQueue.length = 0;
  hoisted.backfillError = null;
  hoisted.lastInsertValues = null;
  // Reset insert chain to mock fresh
  hoisted.insertResult.values.mockImplementation((v: unknown) => {
    hoisted.lastInsertValues = v;
    return hoisted.insertResult;
  });
  hoisted.insertResult.onConflictDoUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("R1 — already in sync: no writes", () => {
  it("logs accuracy and makes no DB writes when counter matches ledger", async () => {
    // count = 5, counter = 5 → in sync
    hoisted.selectQueue.push([{ total: 5 }]);          // select #1: redemption count
    hoisted.selectQueue.push([{ id: 1, redeemed: 5 }]); // select #2: counter row

    await reconcileFoundingCounter();

    expect(hoisted.insertResult.values).not.toHaveBeenCalled();
    expect(hoisted.loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ redeemed: 5 }),
      expect.stringContaining("accurate"),
    );
  });

  it("is a no-op when both tables are empty (fresh deploy, no redemptions)", async () => {
    // count = 0, counter row absent → both effectively 0
    hoisted.selectQueue.push([{ total: 0 }]);
    hoisted.selectQueue.push([]); // no counter row yet

    await reconcileFoundingCounter();

    expect(hoisted.insertResult.values).not.toHaveBeenCalled();
  });
});

describe("R2 — counter drift without legacy data: counter corrected", () => {
  it("updates the counter when ledger has rows but counter is stale zero", async () => {
    // 3 redemptions in the ledger, counter stuck at 0
    hoisted.selectQueue.push([{ total: 3 }]);
    hoisted.selectQueue.push([{ id: 1, redeemed: 0 }]);

    await reconcileFoundingCounter();

    expect(hoisted.insertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ redeemed: 3 }),
    );
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storedCount: 0, actualCount: 3 }),
      expect.stringContaining("drift"),
    );
  });
});

describe("R3 — legacy back-fill from stripe.checkout_sessions", () => {
  it("back-fills the ledger then sets the counter to the post-backfill count", async () => {
    // After backfill, the ledger count is 4 (simulate backfill inserted rows).
    // Counter was 0 (tables were absent during the gap).
    hoisted.selectQueue.push([{ total: 4 }]);
    hoisted.selectQueue.push([{ id: 1, redeemed: 0 }]);

    await reconcileFoundingCounter();

    // Counter must be corrected to 4.
    expect(hoisted.insertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ redeemed: 4 }),
    );
    expect(hoisted.loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ previous: 0, corrected: 4 }),
      expect.stringContaining("reconciled"),
    );
  });
});

describe("R4 — stripe.checkout_sessions unavailable: graceful degradation", () => {
  it("logs a warning and still reconciles from the existing ledger when backfill throws", async () => {
    hoisted.backfillError = new Error("relation \"stripe.checkout_sessions\" does not exist");

    // Ledger already has 2 rows (from earlier successful webhooks), counter = 2.
    hoisted.selectQueue.push([{ total: 2 }]);
    hoisted.selectQueue.push([{ id: 1, redeemed: 2 }]);

    await reconcileFoundingCounter();

    // A warning about the backfill failure must appear.
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: hoisted.backfillError }),
      expect.stringContaining("Back-fill"),
    );
    // Counter matches ledger, so no upsert needed.
    expect(hoisted.insertResult.values).not.toHaveBeenCalled();
  });

  it("still corrects the counter even when backfill is unavailable", async () => {
    hoisted.backfillError = new Error("stripe schema missing");

    // Ledger has 2 rows, counter = 0 (missed webhooks during downtime).
    hoisted.selectQueue.push([{ total: 2 }]);
    hoisted.selectQueue.push([{ id: 1, redeemed: 0 }]);

    await reconcileFoundingCounter();

    expect(hoisted.insertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ redeemed: 2 }),
    );
  });
});

describe("R5 — counter over-count corrected downward", () => {
  it("reduces the counter when it exceeds the actual ledger count", async () => {
    // Counter somehow got ahead of the ledger (edge case: manual edit, bug).
    hoisted.selectQueue.push([{ total: 2 }]);
    hoisted.selectQueue.push([{ id: 1, redeemed: 7 }]);

    await reconcileFoundingCounter();

    expect(hoisted.insertResult.values).toHaveBeenCalledWith(
      expect.objectContaining({ redeemed: 2 }),
    );
    expect(hoisted.loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ storedCount: 7, actualCount: 2 }),
      expect.stringContaining("drift"),
    );
  });
});
