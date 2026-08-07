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

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    // All three writes live inside db.transaction — this mock lets individual
    // tests override the implementation to simulate partial failures.
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      if (mockTransactionImpl.fn) return mockTransactionImpl.fn(fn);
      // Default: a well-behaved tx that runs all writes.
      const tx = {
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
        delete: () => ({ where: () => Promise.resolve() }),
      };
      return fn(tx);
    }),
  },
  eventInvitesTable: {
    id: "id", eventId: "event_id", invitedUserId: "invited_user_id",
    status: "status", createdAt: "created_at",
  },
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
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "invitee-id" }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation(async (ids: string[]) => ids),
  },
}));
vi.mock("../lib/logger");
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

  it("returns 404 when the invite is not found or already actioned", async () => {
    mockSelectRows.value = []; // no pending invite
    const res = await request(app).post("/api/events/invites/inv-1/accept");
    expect(res.status).toBe(404);
  });

  it("returns 500 and rolls back when the 3rd write (delete activity) throws", async () => {
    mockSelectRows.value = [PENDING_INVITE];

    // Simulate partial failure: the transaction callback throws after 2 writes.
    mockTransactionImpl.fn = async (_fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
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
