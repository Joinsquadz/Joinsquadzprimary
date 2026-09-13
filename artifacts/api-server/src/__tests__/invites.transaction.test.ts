/**
 * C1 regression: the 3-write invite-accept flow must run inside a DB
 * transaction so a failure between writes rolls all of them back.
 *
 * Tests:
 *   1. Normal accept — all three writes succeed, 200 returned.
 *   2. Partial failure (tx.delete throws) — transaction rejected, 500
 *      returned; the two preceding writes were never committed.
 *   3. Normal decline — two writes succeed, 200 returned.
 *   4. Partial failure on decline (tx.delete throws) — 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state ────────────────────────────────────────────────────────────
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockTransactionImpl = vi.hoisted(() => ({
  fn: null as null | ((fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>),
}));
const mockBlocks = vi.hoisted(() => ({
  table: { id: "block_id", blockerId: "blocker_id", blockedId: "blocked_id" },
  value: [] as unknown[],
}));
const mockEventInvites = vi.hoisted(() => ({
  table: {
    id: "id", eventId: "event_id", invitedUserId: "invited_user_id",
    inviterUserId: "inviter_user_id", status: "status", createdAt: "created_at",
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
     select: () => ({
       from: (table: unknown) => {
         const rows = table === mockBlocks.table || (table as { blockerId?: string })?.blockerId === mockBlocks.table.blockerId
           ? mockBlocks.value
           : mockSelectRows.value;
         return {
         where: () => Object.assign(Promise.resolve(rows), {
           orderBy: () => Promise.resolve(rows),
         }),
         };
       },
       }),
    // All three writes live inside db.transaction — this mock lets individual
    // tests override the implementation to simulate partial failures.
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (mockTransactionImpl.fn) return mockTransactionImpl.fn(fn);
      // Default: a well-behaved tx that runs all writes.
      // The first update is the invite-status CAS (must return a row so the
      // route knows it won the race); subsequent updates return [] (not checked).
      let updateCallCount = 0;
      const tx = {
        // #633: accepting an invite also claims a plan slot / squad-history row
        // inside this same tx (advisory lock + ON CONFLICT DO NOTHING insert).
        execute: () => Promise.resolve(),
        select: () => ({
          from: (table: unknown) => {
            // The plan-slot count LEFT JOINs events onto the ledger, and the
            // "already claimed?" probe is a plain where().limit() — support both.
            const where = () => {
              const rows: unknown[] = table === mockBlocks.table ? mockBlocks.value : [{ count: 0 }];
              return Object.assign(Promise.resolve(rows), {
                limit: () => Promise.resolve(rows.slice(0, 1)),
                orderBy: () => ({ limit: () => Promise.resolve([]) }),
              });
            };
            return { where, leftJoin: () => ({ where }) };
          },
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
            onConflictDoNothing: () => Promise.resolve(undefined),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              // 1 = invite-status CAS (must win the race), 2 = the events
              // access grant (must match a row, else the route aborts because
              // the plan was deleted mid-flight).
              returning: () =>
                Promise.resolve(
                  ++updateCallCount === 1
                    ? [{ id: "inv-1" }]
                    : updateCallCount === 2
                      ? [{ id: "event-1" }]
                      : [],
                ),
            }),
          }),
        }),
        delete: () => ({ where: () => Promise.resolve() }),
      };
      return fn(tx);
    }),
  },
  eventInvitesTable: mockEventInvites.table,
  eventsTable: {
    id: "id", version: "version", invitedUserIds: "invited_user_ids",
    hostId: "host_id", squadId: "squad_id", rsvps: "rsvps",
  },
  activityTable: { id: "id", type: "type", subjectId: "subject_id", userId: "user_id" },
  squadsTable: { id: "id", memberIds: "member_ids" },
  squadInvitesTable: {
    id: "id", squadId: "squad_id", inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id", status: "status", squadName: "squad_name",
  },
  usersTable: { id: "id", isSquadzPlus: "is_squadz_plus" },
  squadMemberHistoryTable: { userId: "user_id", squadId: "squad_id", joinedAt: "joined_at", leftAt: "left_at" },
  eventCreationsTable: { id: "id", userId: "user_id", eventId: "event_id", source: "source", createdAt: "created_at" },
  userBlocksTable: mockBlocks.table,
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "invitee-id" }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation(async (ids: string[]) => ids),
  },
}));
vi.mock("../lib/logger", () => ({ logger: { error: (...a: unknown[]) => console.error("LOGERR", ...a), info: () => {}, warn: () => {}, debug: () => {}, child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) } }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/squadLimit", async (importOriginal) => importOriginal());

import invitesRouter from "../routes/invites";
import { makeTestApp } from "./helpers/makeTestApp";

const app = makeTestApp(invitesRouter, { id: "invitee-id" });

const PENDING_INVITE = {
  id: "inv-1",
  eventId: "event-1",
  invitedUserId: "invitee-id",
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows.value = [];
  mockBlocks.value = [];
  mockTransactionImpl.fn = null;
});

// ── Accept ────────────────────────────────────────────────────────────────────
describe("POST /api/events/invites/:id/accept", () => {
  it("returns 200 when all three writes succeed inside the transaction", async () => {
    mockSelectRows.value = [PENDING_INVITE];
    const res = await request(app).post("/api/events/invites/inv-1/accept");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.eventId).toBe("event-1");
  });

  it("rejects acceptance when either user blocked the other after the invite was sent", async () => {
    mockSelectRows.value = [PENDING_INVITE];
    mockBlocks.value = [{ blockerId: "invitee-id", blockedId: "host-id" }];

    const res = await request(app).post("/api/events/invites/inv-1/accept");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("This invite is no longer available.");
  });

  it("returns 404 when the invite is not found or already actioned", async () => {
    mockSelectRows.value = []; // no pending invite
    const res = await request(app).post("/api/events/invites/inv-1/accept");
    expect(res.status).toBe(404);
  });

  it("rolls back when the plan was deleted between lookup and accept", async () => {
    mockSelectRows.value = [PENDING_INVITE];
    let rolledBack = false;

    // The invite-status CAS wins, but the events update matches ZERO rows —
    // the plan is gone. Access lives only in events.invited_user_ids, so an
    // accept that shrugged this off would leave the invite marked accepted and
    // burn one of three free plan slots on a plan the user can never open.
    mockTransactionImpl.fn = async (fn: (tx: unknown) => Promise<unknown>) => {
      let updateCallCount = 0;
      const tx = {
        execute: () => Promise.resolve(),
        select: () => ({
          from: () => {
            const where = () =>
              Object.assign(Promise.resolve([{ count: 0 }]), {
                limit: () => Promise.resolve([]),
                orderBy: () => ({ limit: () => Promise.resolve([]) }),
              });
            return { where, leftJoin: () => ({ where }) };
          },
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
            onConflictDoNothing: () => Promise.resolve(undefined),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () =>
                Promise.resolve(++updateCallCount === 1 ? [{ id: "inv-1" }] : []),
            }),
          }),
        }),
        delete: () => ({ where: () => Promise.resolve() }),
      };
      try {
        return await fn(tx);
      } catch (err) {
        rolledBack = true; // the throw is what makes Postgres roll the tx back
        throw err;
      }
    };

    const res = await request(app).post("/api/events/invites/inv-1/accept");

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(rolledBack).toBe(true);
  });

  it("returns 500 and rolls back when the 3rd write (delete activity) throws", async () => {
    mockSelectRows.value = [PENDING_INVITE];

    // Simulate partial failure: the transaction callback throws after 2 writes.
    mockTransactionImpl.fn = async (_fn: (tx: unknown) => Promise<unknown>) => {
      // First update is the invite-status CAS — must return a row so the code
      // proceeds past the early-return guard and reaches the delete that throws.
      let updateCallCount = 0;
      const tx = {
        update: () => ({
          set: () => ({
            where: () => ({
              // 1 = invite-status CAS (must win the race), 2 = the events
              // access grant (must match a row, else the route aborts because
              // the plan was deleted mid-flight).
              returning: () =>
                Promise.resolve(
                  ++updateCallCount === 1
                    ? [{ id: "inv-1" }]
                    : updateCallCount === 2
                      ? [{ id: "event-1" }]
                      : [],
                ),
            }),
          }),
        }),
        // tx.delete throws — simulates DB error after status+invitedUserIds are written.
        delete: () => ({
          where: () => {
            throw new Error("simulated DB error on 3rd write");
          },
        }),
      };
      // The transaction propagates the error, triggering a rollback in real Postgres.
      return _fn(tx);
    };

    const res = await request(app).post("/api/events/invites/inv-1/accept");
    // Route must catch the propagated error and return 500.
    expect(res.status).toBe(500);
  });
});


// ── Decline ───────────────────────────────────────────────────────────────────
describe("POST /api/events/invites/:id/decline", () => {
  it("returns 200 when both writes succeed inside the transaction", async () => {
    mockSelectRows.value = [PENDING_INVITE];
    const res = await request(app).post("/api/events/invites/inv-1/decline");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 500 and rolls back when tx.delete throws", async () => {
    mockSelectRows.value = [PENDING_INVITE];

    mockTransactionImpl.fn = async (_fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
        delete: () => ({
          where: () => { throw new Error("simulated DB error on decline delete"); },
        }),
      };
      return _fn(tx);
    };

    const res = await request(app).post("/api/events/invites/inv-1/decline");
    expect(res.status).toBe(500);
  });
});
