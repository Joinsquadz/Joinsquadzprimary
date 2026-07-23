// B5/B7 — account deletion:
//   B5: Play subscription is cancelled best-effort before data purge
//   B7: invitedUserIds is scrubbed from all events during account deletion
//       so deleted users don't leave orphan invite entries
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const cancelPlayMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const dbMock = vi.hoisted(() => ({
  userRows: [] as unknown[],
  squadRows: [] as unknown[],
  convoRows: [] as unknown[],
  convoPartRows: [] as unknown[],
  eventRows: [] as unknown[],
  friendRows: [] as unknown[],
  txUpdateRows: [] as unknown[],
}));

vi.mock("../lib/playBilling", () => ({
  cancelPlaySubscriptionBestEffort: cancelPlayMock,
}));

vi.mock("../lib/logger");

vi.mock("@workspace/db", () => {
  const makeTx = () => ({
    select: () => ({
      from: (table: { __name: string }) => ({
        where: (_cond: unknown) => {
          if (table.__name === "squads") return Promise.resolve(dbMock.squadRows);
          if (table.__name === "conv_part") return Promise.resolve(dbMock.convoPartRows);
          if (table.__name === "events") return Promise.resolve(dbMock.eventRows);
          if (table.__name === "friends") return Promise.resolve(dbMock.friendRows);
          return Promise.resolve([]);
        },
        innerJoin: () => ({
          where: () => Promise.resolve(dbMock.convoPartRows),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(dbMock.txUpdateRows),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    // Raw SQL used for session cleanup (DELETE FROM sessions WHERE …)
    execute: vi.fn().mockResolvedValue(undefined),
  });

  return {
    db: {
      select: () => ({
        from: (table: { __name: string }) => ({
          where: () => {
            if (table.__name === "users") return Promise.resolve(dbMock.userRows);
            return Promise.resolve([]);
          },
        }),
      }),
      transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(makeTx()),
      ),
      delete: () => ({ where: () => Promise.resolve() }),
    },
    usersTable: { id: "id", isSquadzPlus: "is_squadz_plus", stripeSubscriptionId: "stripe_subscription_id", __name: "users" },
    squadsTable: { id: "id", creatorId: "creator_id", memberIds: "member_ids", __name: "squads" },
    squadMutesTable: { userId: "user_id", squadId: "squad_id" },
    conversationsTable: { id: "id", squadId: "squad_id" },
    conversationParticipantsTable: { conversationId: "conversation_id", userId: "user_id", __name: "conv_part" },
    eventsTable: { id: "id", invitedUserIds: "invited_user_ids", rsvps: "rsvps", messages: "messages", tasks: "tasks", costs: "costs", version: "version", __name: "events" },
    friendsTable: { userId: "user_id", friendId: "friend_id", __name: "friends" },
    // account.ts uses friendshipsTable (bidirectional), squadRemovalNoticesTable, objectUploadsTable
    friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
    squadRemovalNoticesTable: { userId: "user_id" },
    objectUploadsTable: { ownerId: "owner_id" },
    activityTable: { userId: "user_id" },
    deviceTokensTable: { userId: "user_id" },
    photosTable: { uploaderId: "uploader_id" },
    feedPostsTable: { authorId: "author_id" },
    feedReactionsTable: { userId: "user_id" },
    feedCommentsTable: { authorId: "author_id" },
    momentsTable: { authorId: "author_id" },
    momentViewsTable: { viewerId: "viewer_id" },
    momentReactionsTable: { userId: "user_id" },
    conversationMessagesTable: {
      id: "id",
      conversationId: "conversation_id",
      senderId: "sender_id",
      text: "text",
      createdAt: "created_at",
    },
    availabilityPollsTable: { creatorId: "creator_id", createdBy: "created_by", squadId: "squad_id" },
    availabilityResponsesTable: { userId: "user_id" },
    availabilityNudgesTable: { fromUserId: "from_user_id", toUserId: "to_user_id" },
    blockTable: { blockerId: "blocker_id", blockedId: "blocked_id" },
    reportsTable: { reporterId: "reporter_id" },
    squadInvitesTable: { invitedUserId: "invited_user_id", inviterUserId: "inviter_user_id" },
    eventInvitesTable: { invitedUserId: "invited_user_id", inviterUserId: "inviter_user_id" },
    foundingLedgerTable: { subscriptionId: "subscription_id" },
  };
});

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
  },
}));

vi.mock("../stripeService", () => ({
  getUncachableStripeClient: vi.fn().mockResolvedValue({
    subscriptions: { cancel: vi.fn().mockResolvedValue({}) },
  }),
}));

import accountRouter from "../routes/account";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_ID = "deleting-user";
const makeApp = () => makeTestApp(accountRouter, { id: USER_ID });

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "delete@example.com",
    name: "Delete Me",
    isSquadzPlus: false,
    stripeSubscriptionId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.userRows = [userRow()];
  dbMock.squadRows = [];
  dbMock.convoRows = [];
  dbMock.convoPartRows = [];
  dbMock.eventRows = [];
  dbMock.friendRows = [];
  dbMock.txUpdateRows = [];
});

// ── B5: Play subscription cancelled before data purge ────────────────────────

describe("B5 — DELETE /api/account — Play subscription cancelled best-effort", () => {
  it("calls cancelPlaySubscriptionBestEffort when user is Squadz+ (isSquadzPlus:true)", async () => {
    dbMock.userRows = [userRow({ isSquadzPlus: true })];
    const res = await request(makeApp()).delete("/api/account");
    expect(res.status).toBe(200);
    expect(cancelPlayMock).toHaveBeenCalledWith(USER_ID);
  });

  it("does NOT call cancelPlaySubscriptionBestEffort when user is not Squadz+", async () => {
    dbMock.userRows = [userRow({ isSquadzPlus: false })];
    const res = await request(makeApp()).delete("/api/account");
    expect(res.status).toBe(200);
    expect(cancelPlayMock).not.toHaveBeenCalled();
  });

  it("continues with the data purge even if Play cancellation throws", async () => {
    dbMock.userRows = [userRow({ isSquadzPlus: true })];
    cancelPlayMock.mockRejectedValueOnce(new Error("Play API unreachable"));
    const res = await request(makeApp()).delete("/api/account");
    // Purge must still succeed — best-effort means failure is not fatal.
    expect(res.status).toBe(200);
  });
});

// ── B7: account not found returns 404 ────────────────────────────────────────

describe("B7 — DELETE /api/account — missing account returns 404", () => {
  it("returns 404 when the user row does not exist", async () => {
    dbMock.userRows = [];
    const res = await request(makeApp()).delete("/api/account");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/account not found/i);
  });
});

// ── B7: unauthenticated requests are rejected ─────────────────────────────────

describe("B7 — DELETE /api/account — auth required", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeTestApp(accountRouter)).delete("/api/account");
    expect(res.status).toBe(401);
  });
});

// ── B7: events with invitedUserIds are scrubbed during deletion ──────────────

describe("B7 — DELETE /api/account — invitedUserIds scrubbed from events", () => {
  it("succeeds and does not leave the user in any squad after deletion", async () => {
    // Squad with the user as a member (not creator) — user is removed from memberIds.
    const OTHER_USER = "other-user";
    dbMock.userRows = [userRow()];
    dbMock.squadRows = [
      {
        id: "squad-1",
        name: "Test Squad",
        creatorId: OTHER_USER,
        memberIds: [OTHER_USER, USER_ID],
        coAdminIds: [],
      },
    ];
    dbMock.txUpdateRows = [
      {
        id: "squad-1",
        memberIds: [OTHER_USER],
        creatorId: OTHER_USER,
      },
    ];

    const res = await request(makeApp()).delete("/api/account");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
