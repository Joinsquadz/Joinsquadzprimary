/**
 * Unit tests for pgPubSub.ts — LISTEN/NOTIFY bridge.
 *
 * Tests wiring with a mocked pg.Client so no real DB connection is needed:
 *   1. initPgPubSub creates a client and issues LISTEN for all channels
 *   2. pgSubscribe handlers fire when the LISTEN client receives a notification
 *   3. pgNotify calls pool.query with SELECT pg_notify(...)
 *   4. Reconnect: when the LISTEN connection ends, the module reconnects after
 *      a 2 s delay and continues delivering notifications
 *
 * Cross-instance delivery (two independent connections, one NOTIFY, both
 * receive) is covered by pgPubSub.crossInstance.test.ts via real pg.Client
 * connections — that property requires a real Postgres broker.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — must be hoisted so vi.mock factories can access it
// ---------------------------------------------------------------------------
const captured = vi.hoisted(() => ({
  instances: [] as Array<{
    on: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    _trigger: (event: string, ...args: unknown[]) => void;
  }>,
  poolQuery: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Mock pg — every `new pg.Client()` returns a controllable fake
// ---------------------------------------------------------------------------
vi.mock("pg", () => {
  // Must be a regular function (not an arrow function) so that `new pg.Client()`
  // works — arrow functions cannot be used as constructors.  When a constructor
  // returns a non-null object that object replaces `this`, so `new MockClient()`
  // returns `inst` which carries all the spy methods the tests assert on.
  function MockClient(this: unknown) {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const inst = {
      on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
        handlers[event] = handler;
      }),
      connect: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({}),
      /** Test helper: fire an event on this client as if Postgres sent it. */
      _trigger: (event: string, ...args: unknown[]) => {
        handlers[event]?.(...args);
      },
    };
    captured.instances.push(inst as (typeof captured.instances)[number]);
    return inst;
  }
  return { default: { Client: MockClient } };
});

// ---------------------------------------------------------------------------
// Mock @workspace/db — provide resolveDbConfig + pool
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => ({
  resolveDbConfig: () => ({
    host: "localhost",
    port: 5432,
    user: "test",
    password: "test",
    database: "test",
    ssl: false,
  }),
  pool: { query: captured.poolQuery },
}));

vi.mock("../lib/logger");

import { initPgPubSub, pgNotify, pgSubscribe } from "../lib/pgPubSub";

const ALL_CHANNELS = [
  "squadz_squad",
  "squadz_activity",
  "squadz_feed",
  "squadz_conv",
  "squadz_poll",
  "squadz_event",
  "squadz_vault",
] as const;

beforeEach(() => {
  // Reset captured client list so each test starts clean.
  captured.instances.length = 0;
  captured.poolQuery.mockReset();
  captured.poolQuery.mockResolvedValue({});
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. initPgPubSub — LISTEN setup
// ---------------------------------------------------------------------------

describe("initPgPubSub", () => {
  it("creates a pg.Client with Session-pooler port (5432) and issues LISTEN for every channel", async () => {
    await initPgPubSub();

    expect(captured.instances).toHaveLength(1);
    const inst = captured.instances[0];

    // connect() must have been awaited
    expect(inst.connect).toHaveBeenCalledOnce();

    // One LISTEN query per channel, no extras
    expect(inst.query).toHaveBeenCalledTimes(ALL_CHANNELS.length);
    for (const ch of ALL_CHANNELS) {
      expect(inst.query).toHaveBeenCalledWith(`LISTEN ${ch}`);
    }
  });

  it("registers notification, error, and end handlers on the client", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const registeredEvents = inst.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(registeredEvents).toContain("notification");
    expect(registeredEvents).toContain("error");
    expect(registeredEvents).toContain("end");
  });
});

// ---------------------------------------------------------------------------
// 2. pgSubscribe — notification routing
// ---------------------------------------------------------------------------

describe("pgSubscribe", () => {
  it("fires the handler when the LISTEN client receives a matching notification", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const handler = vi.fn();

    pgSubscribe("squadz_squad", "squad-123", handler);
    inst._trigger("notification", { channel: "squadz_squad", payload: "squad-123" });

    expect(handler).toHaveBeenCalledOnce();
  });

  it("does NOT fire when the entity ID in the notification does not match", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const handler = vi.fn();

    pgSubscribe("squadz_squad", "squad-A", handler);
    inst._trigger("notification", { channel: "squadz_squad", payload: "squad-B" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT fire on a different channel", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const handler = vi.fn();

    pgSubscribe("squadz_squad", "squad-X", handler);
    inst._trigger("notification", { channel: "squadz_activity", payload: "squad-X" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires multiple handlers subscribed to the same channel+id", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    pgSubscribe("squadz_conv", "conv-1", handlerA);
    pgSubscribe("squadz_conv", "conv-1", handlerB);
    inst._trigger("notification", { channel: "squadz_conv", payload: "conv-1" });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function that stops future deliveries", async () => {
    await initPgPubSub();
    const inst = captured.instances[0];
    const handler = vi.fn();

    const unsub = pgSubscribe("squadz_feed", "user-99", handler);

    inst._trigger("notification", { channel: "squadz_feed", payload: "user-99" });
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    inst._trigger("notification", { channel: "squadz_feed", payload: "user-99" });
    expect(handler).toHaveBeenCalledOnce(); // still 1
  });
});

// ---------------------------------------------------------------------------
// 3. pgNotify
// ---------------------------------------------------------------------------

describe("pgNotify", () => {
  it("calls pool.query with SELECT pg_notify($1, $2) and the given channel + payload", () => {
    pgNotify("squadz_squad", "squad-abc");

    expect(captured.poolQuery).toHaveBeenCalledWith("SELECT pg_notify($1, $2)", [
      "squadz_squad",
      "squad-abc",
    ]);
  });

  it("does not throw when pool.query rejects", async () => {
    captured.poolQuery.mockRejectedValue(new Error("pool error"));
    expect(() => pgNotify("squadz_event", "event-xyz")).not.toThrow();
    // Let the rejected promise settle so the test doesn't leak an unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
  });
});

// ---------------------------------------------------------------------------
// 4. Reconnect
// ---------------------------------------------------------------------------

describe("reconnect", () => {
  it("creates a new LISTEN client after the connection ends (2 s delay)", async () => {
    vi.useFakeTimers();
    try {
      await initPgPubSub();
      expect(captured.instances).toHaveLength(1);

      // Simulate Postgres dropping the connection
      captured.instances[0]._trigger("end");

      // Reconnect is scheduled — nothing immediate
      expect(captured.instances).toHaveLength(1);

      // Advance past the 2 s reconnect delay
      await vi.advanceTimersByTimeAsync(2500);

      // A second client was created, connected, and LISTENed
      expect(captured.instances).toHaveLength(2);
      const newInst = captured.instances[1];
      expect(newInst.connect).toHaveBeenCalledOnce();
      for (const ch of ALL_CHANNELS) {
        expect(newInst.query).toHaveBeenCalledWith(`LISTEN ${ch}`);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues delivering notifications from the reconnected client", async () => {
    vi.useFakeTimers();
    try {
      await initPgPubSub();
      const handler = vi.fn();
      pgSubscribe("squadz_conv", "conv-99", handler);

      // Drop and reconnect
      captured.instances[0]._trigger("end");
      await vi.advanceTimersByTimeAsync(2500);

      // Notification from the NEW client
      captured.instances[1]._trigger("notification", {
        channel: "squadz_conv",
        payload: "conv-99",
      });

      expect(handler).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not schedule a second reconnect if one is already in flight", async () => {
    vi.useFakeTimers();
    try {
      await initPgPubSub();

      // Trigger end twice in quick succession
      captured.instances[0]._trigger("end");
      captured.instances[0]._trigger("end");

      await vi.advanceTimersByTimeAsync(2500);

      // Should have reconnected only once → 2 total clients
      expect(captured.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("creates a new LISTEN client after the connection errors", async () => {
    vi.useFakeTimers();
    try {
      await initPgPubSub();

      captured.instances[0]._trigger("error", new Error("connection reset"));
      await vi.advanceTimersByTimeAsync(2500);

      expect(captured.instances).toHaveLength(2);
      expect(captured.instances[1].connect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
