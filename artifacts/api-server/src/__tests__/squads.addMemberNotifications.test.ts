import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSquadSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUserSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRow = vi.hoisted(() => ({ value: { id: "invite-abc" } as Record<string, unknown> }));
const selectCallCount = vi.hoisted(() => ({ n: 0 }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const callIndex = selectCallCount.n++;
      return {
        from: () => ({
          where: () =>
            Promise.resolve(
              callIndex === 0
                ? mockSquadSelectRows.value
                : callIndex === 1
                  ? mockUserSelectRows.value
                  : [], // 3rd+ selects: pending-invite existence check → empty = no existing invite
            ),
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
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([mockInsertRow.value]) }),
    }),
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
    creatorId: "creator_id",
    membersCanInvite: "members_can_invite",
  },
  usersTable: { id: "id", friendCode: "friend_code", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url" },
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
}));

const mockGetPushTokensForUsers = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());
const mockClearPushToken = vi.hoisted(() => vi.fn());
const mockFilterUnmutedForSquad = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: mockGetPushTokensForUsers,
    getUser: mockGetUser,
    clearPushToken: mockClearPushToken,
    filterUnmutedForSquad: mockFilterUnmutedForSquad,
  },
}));

const mockSendPushNotifications = vi.hoisted(() => vi.fn());

vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: mockSendPushNotifications,
}));

vi.mock("../lib/logger");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const REQUESTER_ID = "requester-user-id";
const TARGET_ID = "target-user-id";
const EXISTING_MEMBER = "existing-member-id";

const TARGET_TOKEN = "ExponentPushToken[target-token]";
const TARGET_FRIEND_CODE = "ABC123";

const BASE_SQUAD = {
  id: "squad-1",
  name: "Cool Squad",
  emoji: "👥",
  color: "#FF5C3A",
  memberIds: [REQUESTER_ID, EXISTING_MEMBER],
  isPublic: false,
  creatorId: REQUESTER_ID,
  createdAt: new Date().toISOString(),
};

const UPDATED_SQUAD = {
  ...BASE_SQUAD,
  memberIds: [...BASE_SQUAD.memberIds, TARGET_ID],
};

const TARGET_USER = {
  id: TARGET_ID,
  firstName: "Alex",
  lastName: "Rivera",
  profileImageUrl: null,
  friendCode: TARGET_FRIEND_CODE,
};

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount.n = 0;
  mockSquadSelectRows.value = [BASE_SQUAD];
  mockUserSelectRows.value = [TARGET_USER];
  mockUpdateRows.value = [UPDATED_SQUAD];
  mockInsertRow.value = { id: "invite-abc" };
  mockGetUser.mockResolvedValue({ id: REQUESTER_ID, firstName: "Sam", lastName: "Lee" });
  mockFilterUnmutedForSquad.mockResolvedValue([TARGET_ID]);
  mockGetPushTokensForUsers.mockResolvedValue([]);
  mockClearPushToken.mockResolvedValue(undefined);
  mockSendPushNotifications.mockResolvedValue({ staleTokens: [] });
});

// ─── POST /api/squads/:id/members ─────────────────────────────────────────────

describe("POST /api/squads/:id/members — opt-out filter for invite-target notification", () => {
  it("passes requireNotifySquadJoin: true when fetching tokens for the invited user", async () => {
    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      const targetCall = mockGetPushTokensForUsers.mock.calls.find(
        (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
      );
      expect(targetCall).toBeDefined();
    });
  });

  it("queries only the invited user (not other members) with the opt-out filter", async () => {
    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const targetCall = mockGetPushTokensForUsers.mock.calls.find(
      (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
    );
    expect(targetCall).toBeDefined();
    const recipientIds = targetCall![0] as string[];
    expect(recipientIds).toContain(TARGET_ID);
    expect(recipientIds).not.toContain(REQUESTER_ID);
    expect(recipientIds).not.toContain(EXISTING_MEMBER);
  });

  it("does NOT send a push notification when the invited user opted out of squad-join notifications", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return []; // target opted out
        return [];
      },
    );

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const targetCall = mockGetPushTokensForUsers.mock.calls.find(
      (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
    );
    expect(targetCall).toBeDefined();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("does NOT send a push notification when the invited user has muted the squad", async () => {
    mockFilterUnmutedForSquad.mockResolvedValue([]); // target muted this squad

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockFilterUnmutedForSquad).toHaveBeenCalled();
    });

    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("sends a push notification when the invited user opted in", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return [TARGET_TOKEN];
        return [];
      },
    );

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const notifyCall = mockSendPushNotifications.mock.calls[0];
    expect(notifyCall).toBeDefined();
    const [tokens] = notifyCall as [string[], ...unknown[]];
    expect(tokens).toContain(TARGET_TOKEN);
  });

  it("sends the notification with the correct squad and adder data payload", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return [TARGET_TOKEN];
        return [];
      },
    );

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const notifyCall = mockSendPushNotifications.mock.calls[0];
    expect(notifyCall).toBeDefined();
    const [, payload] = notifyCall as [
      string[],
      { title: string; body: string; data: Record<string, string> },
    ];
    expect(payload.title).toBe("Squad invite");
    expect(payload.body).toContain("Sam");
    expect(payload.body).toContain(BASE_SQUAD.name);
    expect(payload.data.screen).toBe("activity");
  });

  it("still calls getPushTokensForUsers with requireNotifySquadJoin even when target has no token", async () => {
    mockGetPushTokensForUsers.mockResolvedValue([]);

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const targetCall = mockGetPushTokensForUsers.mock.calls.find(
      (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
    );
    expect(targetCall).toBeDefined();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("falls back to 'Someone' in the notification body when the adder has no name", async () => {
    mockGetUser.mockResolvedValue({ id: REQUESTER_ID, firstName: null, lastName: null });
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return [TARGET_TOKEN];
        return [];
      },
    );

    const app = makeApp({ id: REQUESTER_ID });
    await request(app)
      .post("/api/squads/squad-1/members")
      .send({ friendCode: TARGET_FRIEND_CODE });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const [, payload] = mockSendPushNotifications.mock.calls[0] as [
      string[],
      { body: string },
    ];
    expect(payload.body).toContain("Someone");
  });
});
