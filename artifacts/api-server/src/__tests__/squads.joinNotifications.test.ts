import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
        orderBy: () => Promise.resolve(mockSelectRows.value),
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
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
  },
  squadsTable: { id: "id", memberIds: "member_ids", createdAt: "created_at" },
  usersTable: { id: "id", friendCode: "friend_code" },
}));

const mockGetPushTokensForUsers = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());
const mockClearPushToken = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: mockGetPushTokensForUsers,
    getUser: mockGetUser,
    clearPushToken: mockClearPushToken,
  },
}));

const mockSendPushNotifications = vi.hoisted(() => vi.fn());

vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: mockSendPushNotifications,
}));

vi.mock("../lib/logger");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const JOINER_ID = "joiner-user-id";
const MEMBER_A = "member-a-id";
const MEMBER_B = "member-b-id";

const TOKEN_A = "ExponentPushToken[member-a-token]";
const TOKEN_B = "ExponentPushToken[member-b-token]";
const JOINER_TOKEN = "ExponentPushToken[joiner-token]";

const BASE_SQUAD = {
  id: "squad-1",
  name: "Cool Squad",
  emoji: "👥",
  color: "#FF5C3A",
  memberIds: [MEMBER_A, MEMBER_B],
  isPublic: true,
  createdAt: new Date().toISOString(),
};

const UPDATED_SQUAD = {
  ...BASE_SQUAD,
  memberIds: [MEMBER_A, MEMBER_B, JOINER_ID],
};

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows.value = [BASE_SQUAD];
  mockUpdateRows.value = [UPDATED_SQUAD];
  mockGetUser.mockResolvedValue({ id: JOINER_ID, firstName: "Jordan", lastName: null });
  mockGetPushTokensForUsers.mockResolvedValue([]);
  mockClearPushToken.mockResolvedValue(undefined);
  mockSendPushNotifications.mockResolvedValue({ staleTokens: [] });
});

// ─── POST /api/squads/:id/join ────────────────────────────────────────────────

describe("POST /api/squads/:id/join — opt-out filter for existing-member notifications", () => {
  it("passes requireNotifySquadJoin: true when fetching tokens for existing members", async () => {
    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      const memberCall = mockGetPushTokensForUsers.mock.calls.find(
        (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
      );
      expect(memberCall).toBeDefined();
    });
  });

  it("queries only pre-existing members (not the joiner) with the opt-out filter", async () => {
    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const memberCall = mockGetPushTokensForUsers.mock.calls.find(
      (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
    );
    expect(memberCall).toBeDefined();
    const recipientIds = memberCall![0] as string[];
    expect(recipientIds).toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
    expect(recipientIds).not.toContain(JOINER_ID);
  });

  it("sends notifications only to opted-in members when some members opted out", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        // Storage layer filters: MEMBER_A opted in, MEMBER_B opted out
        if (opts?.requireNotifySquadJoin) return [TOKEN_A];
        return [];
      },
    );

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const memberNotifyCall = mockSendPushNotifications.mock.calls.find(
      ([, payload]) => (payload as { body: string }).body.includes("Jordan"),
    );
    expect(memberNotifyCall).toBeDefined();
    const [tokens] = memberNotifyCall as [string[], ...unknown[]];
    expect(tokens).toContain(TOKEN_A);
    expect(tokens).not.toContain(TOKEN_B);
  });

  it("still calls getPushTokensForUsers with requireNotifySquadJoin even when all members opted out", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return []; // all opted out
        return [];
      },
    );

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const memberCall = mockGetPushTokensForUsers.mock.calls.find(
      (c) => (c[1] as Record<string, unknown> | undefined)?.requireNotifySquadJoin === true,
    );
    expect(memberCall).toBeDefined();
  });

  it("sends notifications to all existing members when all opted in", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return [TOKEN_A, TOKEN_B];
        return [];
      },
    );

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const memberNotifyCall = mockSendPushNotifications.mock.calls.find(
      ([, payload]) => (payload as { body: string }).body.includes("Jordan"),
    );
    expect(memberNotifyCall).toBeDefined();
    const [tokens] = memberNotifyCall as [string[], ...unknown[]];
    expect(tokens).toContain(TOKEN_A);
    expect(tokens).toContain(TOKEN_B);
  });

  it("sends the join notification with correct squad data payload", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (_ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return [TOKEN_A, TOKEN_B];
        return [];
      },
    );

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const memberNotifyCall = mockSendPushNotifications.mock.calls.find(
      ([, payload]) => (payload as { body: string }).body.includes("Jordan"),
    );
    expect(memberNotifyCall).toBeDefined();
    const [, payload] = memberNotifyCall as [
      string[],
      { title: string; body: string; data: Record<string, string> },
    ];
    expect(payload.title).toBe(BASE_SQUAD.name);
    expect(payload.body).toContain("Jordan");
    expect(payload.data.screen).toBe("squad");
    expect(payload.data.squadId).toBe(BASE_SQUAD.id);
  });

  it("welcome push to the joiner is NOT gated by requireNotifySquadJoin", async () => {
    mockGetPushTokensForUsers.mockImplementation(
      async (ids: string[], opts?: { requireNotifySquadJoin?: boolean }) => {
        if (opts?.requireNotifySquadJoin) return []; // all existing members opted out
        if ((ids as string[]).includes(JOINER_ID)) return [JOINER_TOKEN];
        return [];
      },
    );

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalled();
    });

    const welcomeCall = mockSendPushNotifications.mock.calls.find(
      ([, payload]) =>
        (payload as { title: string }).title.toLowerCase().includes("welcome"),
    );
    expect(welcomeCall).toBeDefined();
    const [tokens] = welcomeCall as [string[], ...unknown[]];
    expect(tokens).toContain(JOINER_TOKEN);
  });

  it("skips welcome push to joiner when they have no registered token", async () => {
    mockGetPushTokensForUsers.mockResolvedValue([]);

    const app = makeApp({ id: JOINER_ID });
    await request(app).post("/api/squads/squad-1/join");

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalled();
    });

    const welcomeCall = mockSendPushNotifications.mock.calls.find(
      ([, payload]) =>
        (payload as { title: string }).title.toLowerCase().includes("welcome"),
    );
    expect(welcomeCall).toBeUndefined();
  });
});
