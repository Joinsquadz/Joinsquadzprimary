// B8 — host (creatorId) transfer when a member leaves or is removed.
//
// Rules:
//   - If the departing member IS the creator, the creator transfers to the
//     next oldest member (updated[0] after the leaver is filtered out).
//   - If the departing member is NOT the creator, creatorId stays unchanged.
//   - When the last member leaves, the squad is deleted entirely.
//   - The new host gets a quiet in-app update (no push required by spec).
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSquadRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdatedSquadRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// Chainable thenable so .from().where() and other chains all resolve.
function makeChainable(getValue: () => unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    where: (..._: unknown[]) => makeChainable(getValue),
    orderBy: (..._: unknown[]) => makeChainable(getValue),
    limit: (..._: unknown[]) => makeChainable(getValue),
    offset: (..._: unknown[]) => makeChainable(getValue),
    leftJoin: (..._: unknown[]) => makeChainable(getValue),
    innerJoin: (..._: unknown[]) => makeChainable(getValue),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(getValue()).then(res, rej),
  };
  return self;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => makeChainable(() => mockSquadRows.value),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdatedSquadRows.value),
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
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      // Inside transactions (purgeSquadData), events lookup returns [] → no event cascade.
      select: () => ({ from: () => makeChainable(() => []) }),
      update: () => ({
        set: () => ({
          where: () => ({
            // The teardown claim now lives INSIDE the transaction: it must
            // report a won row, or the route treats it as a lost race,
            // rolls the purge back and retries.
            returning: () => Promise.resolve([{ id: "squad-1", memberIds: [] }]),
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
    })),
  },
  squadsTable: {
    id: "id", creatorId: "creator_id", memberIds: "member_ids",
    coAdminIds: "co_admin_ids", name: "name", emoji: "emoji",
  },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  conversationsTable: { id: "id", squadId: "squad_id" },
  conversationParticipantsTable: {
    conversationId: "conversation_id", userId: "user_id",
  },
  activityTable: {
    id: "id", userId: "user_id", squadId: "squad_id",
    subjectType: "subject_type", subjectId: "subject_id",
  },
  eventsTable: {
    id: "id", hostId: "host_id", squadId: "squad_id",
    invitedUserIds: "invited_user_ids",
  },
  eventInvitesTable: { id: "id", eventId: "event_id" },
  squadInvitesTable: { id: "id", squadId: "squad_id" },
  availabilityPollsTable: { id: "id", squadId: "squad_id" },
  photosTable: { id: "id", squadId: "squad_id", sharedToSquad: "shared_to_squad" },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", name: "User" }),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getFriendIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/squadEvents", () => ({
  emitSquadUpdate: vi.fn(),
  onSquadUpdate: vi.fn().mockReturnValue(() => {}),
}));

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";

const HOST_ID = "host-user-id";
const MEMBER_A = "member-a";
const MEMBER_B = "member-b";

function makeSquad(memberIds: string[], creatorId = HOST_ID) {
  return {
    id: "squad-1",
    name: "Test Squad",
    emoji: "🎉",
    creatorId,
    memberIds,
    coAdminIds: [],
    inviteCode: "ABC123",
  };
}

const makeApp = (userId: string) => makeTestApp(squadsRouter, { id: userId });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── B8: host leaves — creatorId transfers to next member ─────────────────────

describe("B8 — DELETE /api/squads/:id/members/:userId — host transfer on leave", () => {
  it("transfers creatorId to the next member when the host leaves (200)", async () => {
    const squad = makeSquad([HOST_ID, MEMBER_A, MEMBER_B], HOST_ID);
    mockSquadRows.value = [squad];
    const updatedSquad = {
      ...squad,
      memberIds: [MEMBER_A, MEMBER_B],
      creatorId: MEMBER_A,
    };
    mockUpdatedSquadRows.value = [updatedSquad];

    const res = await request(makeApp(HOST_ID))
      .delete(`/api/squads/squad-1/members/${HOST_ID}`);
    expect(res.status).toBe(200);
    // The returned squad must show the new creatorId.
    expect(res.body.creatorId).toBe(MEMBER_A);
    expect(res.body.memberIds).not.toContain(HOST_ID);
  });

  it("does NOT transfer creatorId when a non-host member leaves (200)", async () => {
    const squad = makeSquad([HOST_ID, MEMBER_A, MEMBER_B], HOST_ID);
    mockSquadRows.value = [squad];
    const updatedSquad = {
      ...squad,
      memberIds: [HOST_ID, MEMBER_B],
      creatorId: HOST_ID,
    };
    mockUpdatedSquadRows.value = [updatedSquad];

    const res = await request(makeApp(MEMBER_A))
      .delete(`/api/squads/squad-1/members/${MEMBER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.creatorId).toBe(HOST_ID);
  });
});

// ── B8: host removed by self — squad deleted if last member ──────────────────

describe("B8 — squad deleted when sole member leaves", () => {
  it("deletes the squad when the last member removes themselves (200 with deleted:true)", async () => {
    const squad = makeSquad([HOST_ID], HOST_ID);
    mockSquadRows.value = [squad];
    // Teardown is now claimed with a version-guarded update before the purge
    // transaction runs, so the update must report the row it won.
    mockUpdatedSquadRows.value = [{ ...squad, memberIds: [] }];

    const res = await request(makeApp(HOST_ID))
      .delete(`/api/squads/squad-1/members/${HOST_ID}`);
    // Sole member left — squad is gone; route returns 200 { deleted: true }.
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

// ── B8: host can remove another member (host transfer if needed) ──────────────

describe("B8 — host removes a non-host member — creatorId unchanged", () => {
  it("host removes MEMBER_A — creatorId stays with host (200)", async () => {
    const squad = makeSquad([HOST_ID, MEMBER_A, MEMBER_B], HOST_ID);
    mockSquadRows.value = [squad];
    const updatedSquad = {
      ...squad,
      memberIds: [HOST_ID, MEMBER_B],
      creatorId: HOST_ID,
    };
    mockUpdatedSquadRows.value = [updatedSquad];

    const res = await request(makeApp(HOST_ID))
      .delete(`/api/squads/squad-1/members/${MEMBER_A}`);
    expect(res.status).toBe(200);
    expect(res.body.creatorId).toBe(HOST_ID);
    expect(res.body.memberIds).not.toContain(MEMBER_A);
  });
});

// ── B8: non-host cannot remove another member ────────────────────────────────

describe("B8 — non-host cannot remove a different member", () => {
  it("returns 403 when a regular member tries to remove another member", async () => {
    const squad = makeSquad([HOST_ID, MEMBER_A, MEMBER_B], HOST_ID);
    mockSquadRows.value = [squad];
    const res = await request(makeApp(MEMBER_A))
      .delete(`/api/squads/squad-1/members/${MEMBER_B}`);
    expect(res.status).toBe(403);
  });
});
