/**
 * W-04: `membersCanInvite` is always present in the GET /squads/:id response
 * so clients can gate the invite affordance before attempting the action.
 *
 * Verified:
 *  - GET /api/squads/:id always returns membersCanInvite (true and false).
 *  - POST /api/squads/:id/members returns 403 for non-creator when invite-locked.
 *  - Server-side 403 fires even on direct API calls (bypassing UI gate).
 *  - Creator can still invite even when membersCanInvite: false.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state ─────────────────────────────────────────────────────────────
const mockSelectQueue = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const mockInsertRows   = vi.hoisted(() => ({ value: [] as unknown[] }));

// ── @workspace/db mock ────────────────────────────────────────────────────────
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
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockInsertRows.value),
        onConflictDoNothing: () => Promise.resolve([]),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
  squadsTable: {
    id: "id", memberIds: "member_ids", isPublic: "is_public", version: "version",
    inviteCode: "invite_code", inviteCodeExpiresAt: "invite_code_expires_at",
    creatorId: "creator_id", membersCanInvite: "members_can_invite",
    coAdminIds: "co_admin_ids",
  },
  usersTable:  { id: "id", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url", friendCode: "friend_code", email: "email" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", squadId: "squad_id" },
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status", inviterUserId: "inviter_user_id" },
  squadMemberHistoryTable: { squadId: "squad_id", userId: "user_id" },
  activityTable: { id: "id", recipientId: "recipient_id", type: "type", subjectId: "subject_id" },
  eventsTable: { id: "id", squadId: "squad_id" },
  eventInvitesTable: { eventId: "event_id" },
  conversationsTable: { id: "id", squadId: "squad_id" },
  photosTable: { squadId: "squad_id", sharedToSquad: "shared_to_squad" },
  availabilityPollsTable: { squadId: "squad_id" },
}));

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn().mockResolvedValue(null),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    filterUnmutedForSquad: vi.fn().mockResolvedValue([]),
    setSquadMute: vi.fn().mockResolvedValue(undefined),
    isSquadMemberPublic: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }) }));
vi.mock("../lib/logger");
vi.mock("../lib/squadEvents");
vi.mock("../lib/activity");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const CREATOR   = "creator-1";
const MEMBER    = "member-1";
const OUTSIDER  = "outsider-1";

function squad(overrides: Record<string, unknown> = {}) {
  return {
    id: "squad-99", name: "Test Squad", emoji: "🐺", color: "#abc",
    isPublic: true, memberIds: [CREATOR, MEMBER],
    creatorId: CREATOR, coAdminIds: [], version: 1,
    inviteCode: "XYZXYZ", inviteCodeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    membersCanInvite: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectQueue.queue = [];
  mockInsertRows.value = [];
});

// ─── GET /api/squads/:id ──────────────────────────────────────────────────────

describe("W-04: GET /api/squads/:id includes membersCanInvite", () => {
  it("returns membersCanInvite: false when creator has locked invites", async () => {
    const s = squad({ membersCanInvite: false });
    // Route does 3 selects: squad, members (usersTable), pendingInvitees (squadInvitesTable).
    mockSelectQueue.queue = [[s], [], []];

    const res = await request(makeApp({ id: CREATOR }))
      .get(`/api/squads/${s.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("membersCanInvite", false);
  });

  it("returns membersCanInvite: true when creator has enabled member invites", async () => {
    const s = squad({ membersCanInvite: true });
    mockSelectQueue.queue = [[s], [], []];

    const res = await request(makeApp({ id: CREATOR }))
      .get(`/api/squads/${s.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("membersCanInvite", true);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).get("/api/squads/squad-99");
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/squads/:id/members ─────────────────────────────────────────────

describe("W-04: server 403 when membersCanInvite is false and caller is not creator", () => {
  it("returns 403 for a non-creator when membersCanInvite is false", async () => {
    const s = squad({ membersCanInvite: false });
    mockSelectQueue.queue = [[s]];

    const res = await request(makeApp({ id: MEMBER }))
      .post(`/api/squads/${s.id}/members`)
      .send({ friendCode: "SOMECD" });

    expect(res.status).toBe(403);
  });

  it("returns 403 even for an outsider when membersCanInvite is false", async () => {
    const s = squad({ membersCanInvite: false });
    mockSelectQueue.queue = [[s]];

    const res = await request(makeApp({ id: OUTSIDER }))
      .post(`/api/squads/${s.id}/members`)
      .send({ friendCode: "SOMECD" });

    expect(res.status).toBe(403);
  });

  it("returns 201 for the creator even when membersCanInvite is false", async () => {
    const s = squad({ membersCanInvite: false });
    const target = {
      id: "target-7", firstName: "Tgt", lastName: "U",
      profileImageUrl: null, friendCode: "TGTCD7",
    };
    // Three selects: squad, user-by-code, existing-pending-invite (none).
    mockSelectQueue.queue = [[s], [target], []];
    // Insert returns a proper invite row so the route can read invite.id.
    mockInsertRows.value = [{
      id: "invite-001", squadId: s.id,
      inviterUserId: CREATOR, invitedUserId: "target-7",
      squadName: s.name, squadEmoji: s.emoji,
    }];

    const res = await request(makeApp({ id: CREATOR }))
      .post(`/api/squads/${s.id}/members`)
      .send({ friendCode: "TGTCD7" });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.inviteId).toBe("invite-001");
  });
});
