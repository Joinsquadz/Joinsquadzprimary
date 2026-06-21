import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Queue of rows to return for sequential select().from().where() calls.
// Each entry is one full Promise.resolve([...]) response. Shift one per call.
const mockSelectQueue = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRow = vi.hoisted(() => ({ value: { id: "invite-abc" } as Record<string, unknown> }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const next = mockSelectQueue.queue.shift();
          return Promise.resolve(next ?? []);
        },
        orderBy: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([mockInsertRow.value]) }),
    }),
  },
  squadsTable: { id: "id", memberIds: "member_ids", isPublic: "is_public", inviteCode: "invite_code", createdAt: "created_at", creatorId: "creator_id", membersCanInvite: "members_can_invite" },
  usersTable: { id: "id", friendCode: "friend_code", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: {},
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
}));

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn().mockResolvedValue(null),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    filterUnmutedForSquad: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));

vi.mock("../lib/logger");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const USER_A = "user-a-id";
const USER_B = "user-b-id";
const EXISTING_MEMBER = "existing-member-id";

const PUBLIC_SQUAD = {
  id: "squad-public",
  name: "Public Squad",
  emoji: "👥",
  color: "#FF5C3A",
  memberIds: [EXISTING_MEMBER],
  isPublic: true,
  inviteCode: "INVITE1",
  creatorId: EXISTING_MEMBER,
  createdAt: new Date().toISOString(),
};

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectQueue.queue = [];
  mockUpdateRows.value = [];
  mockInsertRow.value = { id: "invite-abc" };
});

// ─── POST /api/squads/:id/join ────────────────────────────────────────────────

describe("POST /api/squads/:id/join — atomic membership guard", () => {
  it("returns 201 and alreadyMember:false when the DB update succeeds (user was not yet a member)", async () => {
    const updatedSquad = { ...PUBLIC_SQUAD, memberIds: [EXISTING_MEMBER, USER_A] };
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];
    mockUpdateRows.value = [updatedSquad];

    const app = makeApp({ id: USER_A });
    const res = await request(app).post(`/api/squads/${PUBLIC_SQUAD.id}/join`);

    expect(res.status).toBe(201);
    expect(res.body.alreadyMember).toBe(false);
    expect(res.body.squad.memberIds).toContain(USER_A);
  });

  it("returns 200 and alreadyMember:true when the DB update matches 0 rows (concurrent join already added this user)", async () => {
    // Simulate the atomic WHERE NOT @> guard firing: 0 rows returned.
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];
    mockUpdateRows.value = [];

    const app = makeApp({ id: USER_A });
    const res = await request(app).post(`/api/squads/${PUBLIC_SQUAD.id}/join`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });

  it("returns 404 when the squad does not exist", async () => {
    mockSelectQueue.queue = [[]];

    const app = makeApp({ id: USER_A });
    const res = await request(app).post("/api/squads/nonexistent/join");

    expect(res.status).toBe(404);
  });

  it("returns 403 when the squad is private", async () => {
    mockSelectQueue.queue = [[{ ...PUBLIC_SQUAD, isPublic: false }]];

    const app = makeApp({ id: USER_A });
    const res = await request(app).post(`/api/squads/${PUBLIC_SQUAD.id}/join`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/private/i);
  });

  it("returns 401 when no user is authenticated", async () => {
    const app = makeApp();
    const res = await request(app).post(`/api/squads/${PUBLIC_SQUAD.id}/join`);
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/squads/join-via-code ──────────────────────────────────────────

describe("POST /api/squads/join-via-code — atomic membership guard", () => {
  it("returns 201 and alreadyMember:false when the DB update succeeds", async () => {
    const updatedSquad = { ...PUBLIC_SQUAD, memberIds: [EXISTING_MEMBER, USER_B] };
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];
    mockUpdateRows.value = [updatedSquad];

    const app = makeApp({ id: USER_B });
    const res = await request(app)
      .post("/api/squads/join-via-code")
      .send({ code: "INVITE1" });

    expect(res.status).toBe(201);
    expect(res.body.alreadyMember).toBe(false);
    expect(res.body.squad.memberIds).toContain(USER_B);
  });

  it("returns 200 and alreadyMember:true when the DB update matches 0 rows (already a member)", async () => {
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];
    mockUpdateRows.value = [];

    const app = makeApp({ id: USER_B });
    const res = await request(app)
      .post("/api/squads/join-via-code")
      .send({ code: "INVITE1" });

    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });

  it("returns 404 when the invite code is invalid", async () => {
    mockSelectQueue.queue = [[]];

    const app = makeApp({ id: USER_B });
    const res = await request(app)
      .post("/api/squads/join-via-code")
      .send({ code: "BADCODE" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 when no code is provided", async () => {
    const app = makeApp({ id: USER_B });
    const res = await request(app).post("/api/squads/join-via-code").send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 when no user is authenticated", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/squads/join-via-code")
      .send({ code: "INVITE1" });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/squads/:id/members ────────────────────────────────────────────

describe("POST /api/squads/:id/members — atomic membership guard", () => {
  const TARGET_USER = {
    id: "target-user-id",
    firstName: "Taylor",
    lastName: "Smith",
    profileImageUrl: null,
    friendCode: "TAYL01",
  };

  it("returns 201 and invite details when the invite is created", async () => {
    // Three selects: squad, user by friend code, then pending-invite existence check (empty).
    mockSelectQueue.queue = [[PUBLIC_SQUAD], [TARGET_USER], []];
    mockInsertRow.value = { id: "invite-xyz" };

    const app = makeApp({ id: EXISTING_MEMBER });
    const res = await request(app)
      .post(`/api/squads/${PUBLIC_SQUAD.id}/members`)
      .send({ friendCode: "TAYL01" });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.inviteId).toBe("invite-xyz");
    expect(res.body.invitedUser.id).toBe(TARGET_USER.id);
  });

  it("returns 409 when a pending invite already exists for the target", async () => {
    // Third select returns an existing pending invite.
    mockSelectQueue.queue = [[PUBLIC_SQUAD], [TARGET_USER], [{ id: "existing-invite" }]];

    const app = makeApp({ id: EXISTING_MEMBER });
    const res = await request(app)
      .post(`/api/squads/${PUBLIC_SQUAD.id}/members`)
      .send({ friendCode: "TAYL01" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it("returns 403 when requester is not the squad creator", async () => {
    const NON_CREATOR = "non-creator-id";
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];

    const app = makeApp({ id: NON_CREATOR });
    const res = await request(app)
      .post(`/api/squads/${PUBLIC_SQUAD.id}/members`)
      .send({ friendCode: "TAYL01" });

    expect(res.status).toBe(403);
  });

  it("returns 400 when no friendCode is provided", async () => {
    mockSelectQueue.queue = [[PUBLIC_SQUAD]];

    const app = makeApp({ id: EXISTING_MEMBER });
    const res = await request(app)
      .post(`/api/squads/${PUBLIC_SQUAD.id}/members`)
      .send({});

    expect(res.status).toBe(400);
  });
});
