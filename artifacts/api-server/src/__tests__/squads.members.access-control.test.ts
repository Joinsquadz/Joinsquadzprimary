import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Each select call gets its own result so we can simulate the two sequential
// DB reads the route makes: first the squad lookup, then the user-by-friend-code
// lookup. We advance the index on every `select()` call and reset in beforeEach.
const mockSelectCallIdx = vi.hoisted(() => ({ value: 0 }));
const mockSelectResults = vi.hoisted(() => ({ value: [] as unknown[][] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRow = vi.hoisted(() => ({ value: { id: "invite-abc" } as Record<string, unknown> }));
const mockSetArgs = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));
const mockTransactionCalled = vi.hoisted(() => ({ value: false }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const idx = mockSelectCallIdx.value++;
      return {
        from: () => ({
          where: () => Promise.resolve(mockSelectResults.value[idx] ?? []),
        }),
      };
    },
    update: () => ({
      set: (args: Record<string, unknown>) => {
        mockSetArgs.value = args;
        return {
          where: () => ({
            returning: () => Promise.resolve(mockUpdateRows.value),
          }),
        };
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([mockInsertRow.value]),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      mockTransactionCalled.value = true;
      const tx = {
        delete: () => ({ where: () => Promise.resolve() }),
        // purgeSquadData: squad-events lookup + photo unshare inside the tx.
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      };
      return fn(tx);
    },
  },
  squadsTable: {
    id: "id",
    creatorId: "creator_id",
    memberIds: "member_ids",
    membersCanInvite: "members_can_invite",
    createdAt: "created_at",
  },
  usersTable: {
    id: "id",
    friendCode: "friend_code",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
  },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", seenAt: "seen_at" },
  squadMutesTable: { id: "id", userId: "user_id", squadId: "squad_id" },
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
  activityTable: { id: "id", recipientId: "recipient_id" },
  eventsTable: { id: "id", squadId: "squad_id", version: "version", itinerary: "itinerary", polls: "polls", rsvps: "rsvps" },
  eventInvitesTable: { eventId: "event_id" },
  conversationsTable: { id: "id", squadId: "squad_id" },
  photosTable: { squadId: "squad_id", sharedToSquad: "shared_to_squad" },
  availabilityPollsTable: { squadId: "squad_id" },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    filterUnmutedForSquad: vi.fn().mockResolvedValue([]),
    getMutedSquadIdsForUser: vi.fn().mockResolvedValue([]),
    isSquadMutedForUser: vi.fn().mockResolvedValue(false),
    setSquadMute: vi.fn().mockResolvedValue(undefined),
    getSquadVaultPhotos: vi.fn().mockResolvedValue([]),
    setPhotosSharedToSquad: vi.fn().mockResolvedValue([]),
    unsharePhotoFromSquad: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));

vi.mock("../lib/logger");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const CREATOR_ID = "creator-user-id";
const NON_CREATOR_MEMBER_ID = "non-creator-member-id";
const STRANGER_ID = "stranger-user-id";
const TARGET_USER_ID = "target-user-id";
const TARGET_FRIEND_CODE = "FRIEND1";

const baseSquad = {
  id: "squad-1",
  name: "Test Squad",
  emoji: "👥",
  color: "#FF5C3A",
  creatorId: CREATOR_ID,
  memberIds: [CREATOR_ID, NON_CREATOR_MEMBER_ID],
  isPublic: false,
  createdAt: new Date().toISOString(),
};

const targetUser = {
  id: TARGET_USER_ID,
  firstName: "Alice",
  lastName: "Smith",
  profileImageUrl: null,
  friendCode: TARGET_FRIEND_CODE,
};

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectCallIdx.value = 0;
  mockSelectResults.value = [];
  mockUpdateRows.value = [];
  mockSetArgs.value = null;
  mockTransactionCalled.value = false;
  mockInsertRow.value = { id: "invite-abc" };
});

describe("POST /api/squads/:id/members", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(401);
  });

  it("returns 400 when friendCode is missing", async () => {
    mockSelectResults.value = [[baseSquad], []];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 404 when squad does not exist", async () => {
    mockSelectResults.value = [[]], [];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(404);
  });

  it("returns 403 when authenticated user is a member but not the creator", async () => {
    mockSelectResults.value = [[baseSquad], []];
    const app = makeApp({ id: NON_CREATOR_MEMBER_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/creator/i);
  });

  it("returns 403 when authenticated user is a stranger (not in squad at all)", async () => {
    mockSelectResults.value = [[baseSquad], []];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/creator/i);
  });

  it("returns 404 when friend code does not match any user", async () => {
    mockSelectResults.value = [[baseSquad], []];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: "BADCODE" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/friend code/i);
  });

  it("returns 409 when target user is already in the squad", async () => {
    const alreadyMember = { ...targetUser, id: NON_CREATOR_MEMBER_ID };
    mockSelectResults.value = [[baseSquad], [alreadyMember]];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it("returns 201 and invite details when creator successfully invites a new member", async () => {
    // Three selects: squad, user by friend code, pending-invite existence check (empty = no existing invite).
    mockSelectResults.value = [[baseSquad], [targetUser], []];
    mockInsertRow.value = { id: "invite-xyz" };
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.inviteId).toBe("invite-xyz");
    expect(res.body.invitedUser.id).toBe(TARGET_USER_ID);
  });
});

// Squad that includes all three non-stranger participants so DELETE tests can
// exercise every branch without resetting baseSquad.
const squadWithTarget = {
  ...baseSquad,
  memberIds: [CREATOR_ID, NON_CREATOR_MEMBER_ID, TARGET_USER_ID],
};

describe("DELETE /api/squads/:id/members/:userId", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${TARGET_USER_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when requester is a stranger (not in the squad)", async () => {
    mockSelectResults.value = [[squadWithTarget]];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${TARGET_USER_ID}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/access denied/i);
  });

  it("returns 403 when a non-creator member tries to remove a different member", async () => {
    mockSelectResults.value = [[squadWithTarget]];
    const app = makeApp({ id: NON_CREATOR_MEMBER_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${TARGET_USER_ID}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/creator/i);
  });

  it("returns 403 when a non-creator member tries to remove the squad creator", async () => {
    mockSelectResults.value = [[squadWithTarget]];
    const app = makeApp({ id: NON_CREATOR_MEMBER_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${CREATOR_ID}`,
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/creator/i);
  });

  it("returns 200 when the creator removes a non-creator member", async () => {
    const updatedSquad = {
      ...squadWithTarget,
      memberIds: [CREATOR_ID, NON_CREATOR_MEMBER_ID],
    };
    mockSelectResults.value = [[squadWithTarget]];
    mockUpdateRows.value = [updatedSquad];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${TARGET_USER_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.memberIds).not.toContain(TARGET_USER_ID);
  });

  it("returns 200 when a member removes themselves (self-leave)", async () => {
    const updatedSquad = {
      ...squadWithTarget,
      memberIds: [CREATOR_ID, TARGET_USER_ID],
    };
    mockSelectResults.value = [[squadWithTarget]];
    mockUpdateRows.value = [updatedSquad];
    const app = makeApp({ id: NON_CREATOR_MEMBER_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${NON_CREATOR_MEMBER_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.memberIds).not.toContain(NON_CREATOR_MEMBER_ID);
  });

  it("returns 404 when the target user is not in the squad", async () => {
    // STRANGER_ID is not in squadWithTarget.memberIds, but the requester is
    // the creator (so auth passes); the target-not-found 404 fires next.
    mockSelectResults.value = [[squadWithTarget]];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${STRANGER_ID}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not in this squad/i);
  });

  it("transfers ownership to the longest-standing member when the creator leaves", async () => {
    // memberIds are in join order: [CREATOR_ID, NON_CREATOR_MEMBER_ID]. The
    // creator self-leaves, so ownership should pass to NON_CREATOR_MEMBER_ID.
    const squad = {
      ...baseSquad,
      memberIds: [CREATOR_ID, NON_CREATOR_MEMBER_ID],
    };
    mockSelectResults.value = [[squad]];
    mockUpdateRows.value = [
      { ...squad, creatorId: NON_CREATOR_MEMBER_ID, memberIds: [NON_CREATOR_MEMBER_ID] },
    ];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${CREATOR_ID}`,
    );
    expect(res.status).toBe(200);
    expect(mockSetArgs.value).toMatchObject({
      creatorId: NON_CREATOR_MEMBER_ID,
      memberIds: [NON_CREATOR_MEMBER_ID],
    });
    expect(mockTransactionCalled.value).toBe(false);
  });

  it("deletes the squad when the last member leaves", async () => {
    const squad = { ...baseSquad, memberIds: [CREATOR_ID] };
    mockSelectResults.value = [[squad]];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete(
      `/api/squads/squad-1/members/${CREATOR_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(mockTransactionCalled.value).toBe(true);
  });
});
