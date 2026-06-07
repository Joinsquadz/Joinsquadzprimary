import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockInsertRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));

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
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockInsertRows.value),
      }),
    }),
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
  },
}));

const mockGetPushTokensForUsers = vi.hoisted(() => vi.fn());
const mockClearPushToken = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: mockGetPushTokensForUsers,
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

const CREATOR_ID = "creator-user-id";
const MEMBER_A = "member-a-id";
const MEMBER_B = "member-b-id";

const TOKEN_A = "ExponentPushToken[token-a]";
const TOKEN_B = "ExponentPushToken[token-b]";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const BASE_SQUAD = {
  id: "squad-new",
  name: "Weekend Crew",
  emoji: "👥",
  color: "#FF5C3A",
  memberIds: [CREATOR_ID, MEMBER_A, MEMBER_B],
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertRows.value = [BASE_SQUAD];
  mockSelectRows.value = [];
  mockGetPushTokensForUsers.mockResolvedValue([TOKEN_A, TOKEN_B]);
  mockClearPushToken.mockResolvedValue(undefined);
  mockSendPushNotifications.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/squads — push notifications", () => {
  it("returns 201 and the created squad", async () => {
    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("squad-new");
  });

  it("fetches push tokens only for added members, not the creator", async () => {
    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([MEMBER_A, MEMBER_B], { requireNotifySquadJoin: true });
  });

  it("sends push notifications with the squad name and id", async () => {
    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [TOKEN_A, TOKEN_B],
      {
        title: "You've been added to a squad",
        body: `You're now in "${BASE_SQUAD.name}"`,
        data: { screen: "squad", squadId: BASE_SQUAD.id },
      },
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("creator does not receive a push notification for their own squad", async () => {
    const singleMemberSquad = { ...BASE_SQUAD, memberIds: [CREATOR_ID] };
    mockInsertRows.value = [singleMemberSquad];

    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Solo Squad" });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("onStaleToken calls storage.clearPushToken for the stale token", async () => {
    const staleToken = "ExponentPushToken[stale-token]";
    mockGetPushTokensForUsers.mockResolvedValue([staleToken]);
    mockSendPushNotifications.mockImplementation(
      async (_tokens: string[], _payload: unknown, options?: { onStaleToken?: (t: string) => Promise<void> }) => {
        await options?.onStaleToken?.(staleToken);
        return { staleTokens: [staleToken] };
      },
    );

    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A] });

    await vi.waitFor(() => {
      expect(mockClearPushToken).toHaveBeenCalledTimes(1);
    });

    expect(mockClearPushToken).toHaveBeenCalledWith(staleToken);
  });

  it("does not send notifications when no extra members are provided", async () => {
    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Just Me" });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not send notifications to the creator even when they appear in memberIds", async () => {
    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [CREATOR_ID, MEMBER_A] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    });

    const calledWith: string[] = mockGetPushTokensForUsers.mock.calls[0][0] as string[];
    const calledWithOpts = mockGetPushTokensForUsers.mock.calls[0][1] as Record<string, unknown>;
    expect(calledWith).not.toContain(CREATOR_ID);
    expect(calledWith).toContain(MEMBER_A);
    expect(calledWithOpts).toEqual({ requireNotifySquadJoin: true });
  });
});

describe("DELETE /api/squads/:id — push notifications", () => {
  const DELETER_ID = CREATOR_ID;

  const SQUAD_WITH_MEMBERS = {
    ...BASE_SQUAD,
    id: "squad-del",
    name: "Soon Gone",
    memberIds: [DELETER_ID, MEMBER_A, MEMBER_B],
  };

  beforeEach(() => {
    mockSelectRows.value = [SQUAD_WITH_MEMBERS];
  });

  it("returns 204 and notifies other members", async () => {
    const app = makeApp({ id: DELETER_ID });
    const res = await request(app).delete("/api/squads/squad-del");
    expect(res.status).toBe(204);

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([MEMBER_A, MEMBER_B]);
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [TOKEN_A, TOKEN_B],
      {
        title: "Squad deleted",
        body: `"${SQUAD_WITH_MEMBERS.name}" has been deleted`,
        data: { screen: "squads" },
      },
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("does not notify the deleting user", async () => {
    const app = makeApp({ id: DELETER_ID });
    await request(app).delete("/api/squads/squad-del");

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    });

    const calledWith = mockGetPushTokensForUsers.mock.calls[0][0] as string[];
    expect(calledWith).not.toContain(DELETER_ID);
    expect(calledWith).toContain(MEMBER_A);
    expect(calledWith).toContain(MEMBER_B);
  });

  it("does not send notifications when the deleter is the only member", async () => {
    mockSelectRows.value = [{ ...SQUAD_WITH_MEMBERS, memberIds: [DELETER_ID] }];

    const app = makeApp({ id: DELETER_ID });
    await request(app).delete("/api/squads/squad-del");

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("calls clearPushToken for stale tokens via onStaleToken", async () => {
    const staleToken = "ExponentPushToken[stale-del]";
    mockGetPushTokensForUsers.mockResolvedValue([staleToken]);
    mockSendPushNotifications.mockImplementation(
      async (_tokens: string[], _payload: unknown, options?: { onStaleToken?: (t: string) => Promise<void> }) => {
        await options?.onStaleToken?.(staleToken);
        return { staleTokens: [staleToken] };
      },
    );

    const app = makeApp({ id: DELETER_ID });
    await request(app).delete("/api/squads/squad-del");

    await vi.waitFor(() => {
      expect(mockClearPushToken).toHaveBeenCalledTimes(1);
    });

    expect(mockClearPushToken).toHaveBeenCalledWith(staleToken);
  });
});
