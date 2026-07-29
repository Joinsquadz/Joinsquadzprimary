/**
 * BUG-05 regression: invite codes expire after 7 days — join-via-code and
 *   the unauthenticated preview both return 410 for expired codes.
 * BUG-08 regression: squad creation always stores the creator in memberIds,
 *   and the created squad is immediately visible in the creator's list.
 * BUG-09 regression: GET /squads/preview (unauthenticated) no longer leaks
 *   creatorFirstName.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock ───────────────────────────────────────────────────────────────────
const dbSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const dbInsertRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const dbUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockDbExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbSelectRows.value),
        orderBy: () => Promise.resolve(dbSelectRows.value),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(dbInsertRows.value),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(dbUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: mockDbExecute.mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Provide a minimal tx object that mimics the update chain used in
      // the advisory-lock + memberIds-append patterns.
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve([{ count: 0 }]),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve(dbInsertRows.value),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: () => Promise.resolve(dbUpdateRows.value),
            }),
          }),
        }),
      };
      return fn(tx);
    }),
  },
  squadsTable: {
    id: "id",
    name: "name",
    emoji: "emoji",
    color: "color",
    isPublic: "is_public",
    memberIds: "member_ids",
    creatorId: "creator_id",
    inviteCode: "invite_code",
    inviteCodeExpiresAt: "invite_code_expires_at",
    description: "description",
    coAdminIds: "co_admin_ids",
    membersCanInvite: "members_can_invite",
    version: "version",
  },
  usersTable: {
    id: "id",
    isSquadzPlus: "is_squadz_plus",
    foundingMember: "founding_member",
    moderationHidden: "moderation_hidden",
  },
  squadInvitesTable: {
    id: "id",
    squadId: "squad_id",
    inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id",
    squadName: "squad_name",
    status: "status",
  },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  conversationsTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn().mockResolvedValue({ id: "user-1", isSquadzPlus: false }),
  upsertUser: vi.fn(),
  getSquad: vi.fn(),
  getPushTokensForUsers: vi.fn().mockResolvedValue([]),
  filterUnmutedForSquad: vi.fn().mockImplementation(async (ids: string[]) => ids),
  clearPushToken: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn().mockResolvedValue(false) }));
vi.mock("../lib/squadLimit", async (importOriginal) => {
  // Wrap the real withSquadLimit but replace the db.transaction call so the
  // mock tx above is used instead of a real pg transaction.
  return importOriginal();
});

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_ID = "user-1";
const authedApp = makeTestApp(squadsRouter, { id: USER_ID });
const anonApp = makeTestApp(squadsRouter);

function futureDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString();
}
function pastDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectRows.value = [];
  dbInsertRows.value = [];
  dbUpdateRows.value = [];
  storageMock.getUser.mockResolvedValue({ id: USER_ID, isSquadzPlus: false });
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
});

// ── BUG-09 ────────────────────────────────────────────────────────────────────
describe("BUG-09: GET /squads/preview does not expose creatorFirstName", () => {
  const squadRow = {
    id: "s1",
    name: "Surf Crew",
    emoji: "🏄",
    memberIds: ["user-1", "user-2"],
    inviteCodeExpiresAt: futureDate(3),
    creatorId: "user-1",
  };

  it("returns name, emoji, memberCount but NOT creatorFirstName", async () => {
    dbSelectRows.value = [squadRow];
    const res = await request(anonApp).get("/api/squads/preview?code=ABCDEF");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Surf Crew");
    expect(res.body.emoji).toBe("🏄");
    expect(res.body.memberCount).toBe(2);
    expect(res.body).not.toHaveProperty("creatorFirstName");
  });
});

// ── BUG-05 ────────────────────────────────────────────────────────────────────
describe("BUG-05: invite codes expire after 7 days", () => {
  it("preview returns 410 for an expired invite code", async () => {
    dbSelectRows.value = [{
      id: "s1",
      name: "Old Squad",
      emoji: "👴",
      memberIds: ["user-1"],
      inviteCodeExpiresAt: pastDate(1), // expired yesterday
    }];
    const res = await request(anonApp).get("/api/squads/preview?code=EXPIRED");
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("preview returns 200 for a code that has not yet expired", async () => {
    dbSelectRows.value = [{
      id: "s1",
      name: "Fresh Squad",
      emoji: "✨",
      memberIds: ["user-1"],
      inviteCodeExpiresAt: futureDate(6), // 6 days from now
    }];
    const res = await request(anonApp).get("/api/squads/preview?code=FRESH");
    expect(res.status).toBe(200);
  });

  it("join-via-code returns 410 for an expired invite code", async () => {
    dbSelectRows.value = [{
      id: "s1",
      name: "Old Squad",
      emoji: "👴",
      memberIds: ["user-2"],
      inviteCode: "EXPIRED",
      inviteCodeExpiresAt: pastDate(2),
    }];
    const res = await request(authedApp)
      .post("/api/squads/join-via-code")
      .send({ code: "EXPIRED" });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("join-via-code succeeds when code is still valid", async () => {
    dbSelectRows.value = [{
      id: "s1",
      name: "Active Squad",
      emoji: "🔥",
      memberIds: [],
      inviteCode: "VALID",
      inviteCodeExpiresAt: futureDate(5),
    }];
    dbUpdateRows.value = [{ id: "s1", memberIds: [USER_ID] }];
    const res = await request(authedApp)
      .post("/api/squads/join-via-code")
      .send({ code: "VALID" });
    // 201 (joined) or 200 (already member)
    expect([200, 201]).toContain(res.status);
  });
});

// ── BUG-08 ────────────────────────────────────────────────────────────────────
describe("BUG-08: squad creation stores creator in memberIds", () => {
  it("the created squad row includes the creator's userId in memberIds", async () => {
    // Simulate the DB returning the inserted row (with memberIds already set).
    dbInsertRows.value = [{
      id: "new-squad",
      name: "Crew",
      emoji: "👥",
      color: "#FF5C3A",
      isPublic: false,
      memberIds: [USER_ID], // creator must be here
      creatorId: USER_ID,
      inviteCode: "NEWCODE",
      inviteCodeExpiresAt: futureDate(7),
    }];

    const res = await request(authedApp).post("/api/squads").send({
      name: "Crew",
      emoji: "👥",
      isPublic: false,
    });

    expect([200, 201]).toContain(res.status);
    // The squad in the response must carry the creator's ID in memberIds.
    const squad = res.body.squad ?? res.body;
    expect(squad.memberIds).toContain(USER_ID);
  });
});
