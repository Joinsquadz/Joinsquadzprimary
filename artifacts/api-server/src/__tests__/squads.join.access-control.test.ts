import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

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
    isPublic: "is_public",
    inviteCode: "invite_code",
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
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
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

const MEMBER_ID = "existing-member-id";
const STRANGER_ID = "stranger-user-id";

const publicSquad = {
  id: "squad-public",
  name: "Open Squad",
  emoji: "🌍",
  color: "#00AAFF",
  creatorId: MEMBER_ID,
  memberIds: [MEMBER_ID],
  isPublic: true,
  inviteCode: "PUBCODE",
  createdAt: new Date().toISOString(),
};

const privateSquad = {
  ...publicSquad,
  id: "squad-private",
  name: "Secret Squad",
  isPublic: false,
  inviteCode: "PRVCODE",
};

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectCallIdx.value = 0;
  mockSelectResults.value = [];
  mockUpdateRows.value = [];
});

describe("POST /api/squads/:id/join", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/squads/squad-public/join");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the squad does not exist", async () => {
    mockSelectResults.value = [[]];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/squads/nonexistent/join");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 403 when the squad is private (isPublic: false)", async () => {
    mockSelectResults.value = [[privateSquad]];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/squads/squad-private/join");
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/private/i);
  });

  it("returns 200 (idempotent) when the user is already a member", async () => {
    // Second entry: the 0-row path re-reads the squad to distinguish
    // "already a member" from "squad was torn down mid-join".
    mockSelectResults.value = [[publicSquad], [publicSquad]];
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/squads/squad-public/join");
    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
    expect(res.body.squad.id).toBe(publicSquad.id);
  });

  it("returns 201 when a new user joins a public squad", async () => {
    const updatedSquad = {
      ...publicSquad,
      memberIds: [...publicSquad.memberIds, STRANGER_ID],
    };
    mockSelectResults.value = [[publicSquad]];
    mockUpdateRows.value = [updatedSquad];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/squads/squad-public/join");
    expect(res.status).toBe(201);
    expect(res.body.alreadyMember).toBe(false);
    expect(res.body.squad.memberIds).toContain(STRANGER_ID);
  });
});
