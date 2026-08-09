/**
 * W-03: Both join paths atomically bump squad version on every new member.
 *
 * Verified:
 *  - POST /api/squads/:id/join returns the squad with incremented version.
 *  - POST /api/squads/join-via-code returns the squad with incremented version.
 *  - PATCH /api/squads/:id with a stale client version returns 409 conflict.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state ─────────────────────────────────────────────────────────────
const mockSelectQueue = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const mockUpdateRows   = vi.hoisted(() => ({ value: [] as unknown[] }));

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
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => Promise.resolve([]),
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
  usersTable:  { id: "id", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url", friendCode: "friend_code" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", squadId: "squad_id" },
  squadInvitesTable:  { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status", inviterUserId: "inviter_user_id" },
  squadMemberHistoryTable: { squadId: "squad_id", userId: "user_id" },
  activityTable:  { id: "id", recipientId: "recipient_id", type: "type", subjectId: "subject_id" },
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
  },
}));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }) }));
vi.mock("../lib/logger");
vi.mock("../lib/squadEvents");
vi.mock("../lib/activity");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const MEMBER_A = "member-a";
const MEMBER_B = "member-b";
const CREATOR  = "creator-1";

const BASE_SQUAD = {
  id: "squad-1", name: "Test Squad", emoji: "🦊", color: "#ff0",
  isPublic: true, memberIds: [CREATOR], creatorId: CREATOR,
  inviteCode: "INVITE11", version: 3,
  inviteCodeExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  membersCanInvite: false, coAdminIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectQueue.queue = [];
  mockUpdateRows.value = [];
});

// ─── join-by-id ───────────────────────────────────────────────────────────────

describe("W-03: join-by-id bumps squad version", () => {
  it("returns 201 with the squad; mock simulates version bump (version=4)", async () => {
    const updated = { ...BASE_SQUAD, memberIds: [CREATOR, MEMBER_A], version: 4 };
    mockSelectQueue.queue = [[BASE_SQUAD]];
    mockUpdateRows.value = [updated];

    const res = await request(makeApp({ id: MEMBER_A }))
      .post(`/api/squads/${BASE_SQUAD.id}/join`);

    expect(res.status).toBe(201);
    expect(res.body.alreadyMember).toBe(false);
    expect(res.body.squad.version).toBe(4); // version bumped by update
  });

  it("returns 200 alreadyMember:true when update returns 0 rows (guard fired)", async () => {
    // Second entry: the route re-reads the squad on the 0-row path to tell
    // "already a member" apart from "the squad was just torn down".
    mockSelectQueue.queue = [[BASE_SQUAD], [BASE_SQUAD]];
    mockUpdateRows.value = []; // WHERE NOT @> filtered out the update

    const res = await request(makeApp({ id: CREATOR })) // CREATOR is already a member
      .post(`/api/squads/${BASE_SQUAD.id}/join`);

    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });
});

// ─── join-via-code ────────────────────────────────────────────────────────────

describe("W-03: join-via-code bumps squad version", () => {
  it("returns 201 with the squad; mock simulates version bump (version=4)", async () => {
    const updated = { ...BASE_SQUAD, memberIds: [CREATOR, MEMBER_B], version: 4 };
    mockSelectQueue.queue = [[BASE_SQUAD]];
    mockUpdateRows.value = [updated];

    const res = await request(makeApp({ id: MEMBER_B }))
      .post("/api/squads/join-via-code")
      .send({ code: BASE_SQUAD.inviteCode });

    expect(res.status).toBe(201);
    expect(res.body.alreadyMember).toBe(false);
    expect(res.body.squad.version).toBe(4);
  });
});

// ─── stale-version PATCH ──────────────────────────────────────────────────────

describe("W-03: stale-version PATCH /api/squads/:id returns 409", () => {
  it("returns 409 when the client version is behind the server version", async () => {
    const squadWithMember = { ...BASE_SQUAD, memberIds: [CREATOR], version: 5 };
    // SELECT: squad lookup (membership + general fetch)
    mockSelectQueue.queue = [[squadWithMember]];
    // UPDATE: WHERE id AND version=3 matches 0 rows (server is at v5)
    mockUpdateRows.value = [];

    const res = await request(makeApp({ id: CREATOR }))
      .patch(`/api/squads/${BASE_SQUAD.id}`)
      .send({ name: "New Name", version: 3 /* stale */ });

    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});
