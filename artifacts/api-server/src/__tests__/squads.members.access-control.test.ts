import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Each select call gets its own result so we can simulate the two sequential
// DB reads the route makes: first the squad lookup, then the user-by-friend-code
// lookup. We advance the index on every `select()` call and reset in beforeEach.
const mockSelectCallIdx = vi.hoisted(() => ({ value: 0 }));
const mockSelectResults = vi.hoisted(() => ({ value: [] as unknown[][] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

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
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
  squadsTable: {
    id: "id",
    creatorId: "creator_id",
    memberIds: "member_ids",
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

  it("returns 201 when creator successfully adds a new member", async () => {
    const updatedSquad = {
      ...baseSquad,
      memberIds: [...baseSquad.memberIds, TARGET_USER_ID],
    };
    mockSelectResults.value = [[baseSquad], [targetUser]];
    mockUpdateRows.value = [updatedSquad];
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });
    expect(res.status).toBe(201);
    expect(res.body.addedUser.id).toBe(TARGET_USER_ID);
    expect(res.body.squad.memberIds).toContain(TARGET_USER_ID);
  });
});
