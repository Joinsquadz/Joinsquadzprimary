import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRows = vi.hoisted(() => ({ value: [] as unknown[] }));
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
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockInsertRows.value),
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        delete: () => ({ where: () => Promise.resolve() }),
      }),
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    friendCode: "friend_code",
  },
  squadMutesTable: {
    userId: "user_id",
    squadId: "squad_id",
  },
  squadRemovalNoticesTable: {
    id: "id",
    userId: "user_id",
    seenAt: "seen_at",
  },
}));

const mockGetPushTokensForUsers = vi.hoisted(() => vi.fn());
const mockClearPushToken = vi.hoisted(() => vi.fn());
const mockGetUser = vi.hoisted(() => vi.fn());
const mockFilterUnmutedForSquad = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: mockGetPushTokensForUsers,
    clearPushToken: mockClearPushToken,
    getUser: mockGetUser,
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
  mockSelectRows.value = [];
  mockInsertRows.value = [BASE_SQUAD];
  mockUpdateRows.value = [BASE_SQUAD];
  mockGetPushTokensForUsers.mockResolvedValue([TOKEN_A, TOKEN_B]);
  mockClearPushToken.mockResolvedValue(undefined);
  mockGetUser.mockResolvedValue(undefined);
  mockSendPushNotifications.mockResolvedValue({ staleTokens: [] });
  // Default: no one is muted — pass through all user IDs unchanged
  mockFilterUnmutedForSquad.mockImplementation((userIds: string[]) => Promise.resolve(userIds));
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

  it("sends push only to opted-in members when some added members opted out", async () => {
    // Storage layer returns only MEMBER_A's token because MEMBER_B opted out of squad-join pushes
    mockGetPushTokensForUsers.mockResolvedValue([TOKEN_A]);

    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    const [tokens] = mockSendPushNotifications.mock.calls[0] as [string[], ...unknown[]];
    expect(tokens).toContain(TOKEN_A);
    expect(tokens).not.toContain(TOKEN_B);
  });

  it("calls sendPushNotifications with an empty token list when all added members opted out", async () => {
    // Storage layer returns [] because all added members set notifySquadJoin=false
    mockGetPushTokensForUsers.mockResolvedValue([]);

    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    });

    // getPushTokensForUsers was called with the opt-out filter, returned empty
    const [, opts] = mockGetPushTokensForUsers.mock.calls[0] as [string[], Record<string, unknown>];
    expect(opts.requireNotifySquadJoin).toBe(true);

    // sendPushNotifications is invoked but receives an empty token list (no delivery occurs)
    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });
    const [tokens] = mockSendPushNotifications.mock.calls[0] as [string[], ...unknown[]];
    expect(tokens).toHaveLength(0);
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

describe("PATCH /api/squads/:id — push notifications on memberIds change", () => {
  const ACTOR_ID = "actor-user-id";
  const EXISTING_A = "existing-member-a";
  const EXISTING_B = "existing-member-b";
  const NEW_MEMBER = "new-member-id";
  const TOKEN_EXISTING_A = "ExponentPushToken[existing-a]";
  const TOKEN_EXISTING_B = "ExponentPushToken[existing-b]";
  const TOKEN_NEW = "ExponentPushToken[new-member]";

  const existingSquad = {
    id: "squad-patch-1",
    name: "Patch Squad",
    emoji: "👥",
    color: "#FF5C3A",
    memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B],
    createdAt: new Date().toISOString(),
  };

  const updatedSquad = {
    ...existingSquad,
    memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER],
  };

  beforeEach(() => {
    mockSelectRows.value = [existingSquad];
    mockUpdateRows.value = [updatedSquad];
    mockGetUser.mockResolvedValue({ firstName: "Alice", lastName: "Smith" });
    mockGetPushTokensForUsers.mockImplementation(async (ids: string[], _opts?: unknown) => {
      if (Array.isArray(ids) && ids.includes(NEW_MEMBER) && !ids.includes(EXISTING_A)) {
        return [TOKEN_NEW];
      }
      return [TOKEN_EXISTING_A, TOKEN_EXISTING_B];
    });
  });

  it("returns 200 and the updated squad", async () => {
    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-patch-1");
  });

  it("notifies existing members (not the actor) when a new member is added", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(2);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([EXISTING_A, EXISTING_B]);
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [TOKEN_EXISTING_A, TOKEN_EXISTING_B],
      {
        title: existingSquad.name,
        body: `Alice Smith added a new member to "${existingSquad.name}"`,
        data: { screen: "squad", squadId: existingSquad.id },
      },
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("notifies the newly added member with the adder's name and squad name", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(2);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([NEW_MEMBER], { requireNotifySquadJoin: true });
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [TOKEN_NEW],
      {
        title: "You were added to a squad",
        body: `Alice Smith added you to "${existingSquad.name}"`,
        data: { screen: "squad", squadId: existingSquad.id },
      },
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("uses 'Someone' in both notifications when the actor has no name", async () => {
    mockGetUser.mockResolvedValue(null);

    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(2);
    });

    for (const call of mockSendPushNotifications.mock.calls) {
      const payload = call[1] as { body: string };
      expect(payload.body).toContain("Someone");
    }
  });

  it("actor does not receive a notification about their own action", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(2);
    });

    const existingMemberCall: string[] = mockGetPushTokensForUsers.mock.calls[0][0] as string[];
    expect(existingMemberCall).not.toContain(ACTOR_ID);
  });

  it("does not notify newly added members via the existing-member path", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(2);
    });

    const existingMemberCall: string[] = mockGetPushTokensForUsers.mock.calls[0][0] as string[];
    expect(existingMemberCall).not.toContain(NEW_MEMBER);
  });

  it("does not send notifications when memberIds is not in the request body", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ name: "Renamed Squad" });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not send notifications when memberIds contains no new members", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B] });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("notifies the new member even when actor is the only pre-existing member", async () => {
    mockSelectRows.value = [{ ...existingSquad, memberIds: [ACTOR_ID] }];
    mockUpdateRows.value = [{ ...existingSquad, memberIds: [ACTOR_ID, NEW_MEMBER] }];

    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([NEW_MEMBER], { requireNotifySquadJoin: true });
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        title: "You were added to a squad",
        body: expect.stringContaining(existingSquad.name),
      }),
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("cleans up stale tokens from the existing-member notification via clearPushToken", async () => {
    const staleToken = "ExponentPushToken[stale-existing]";
    mockGetPushTokensForUsers.mockResolvedValue([staleToken]);
    mockSendPushNotifications.mockImplementation(
      async (_tokens: string[], _payload: unknown, options?: { onStaleToken?: (t: string) => Promise<void> }) => {
        await options?.onStaleToken?.(staleToken);
        return { staleTokens: [staleToken] };
      },
    );

    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockClearPushToken).toHaveBeenCalledWith(staleToken);
    });
  });

  it("cleans up stale tokens from the new-member notification via clearPushToken", async () => {
    const staleNewToken = "ExponentPushToken[stale-new]";
    mockGetPushTokensForUsers.mockImplementation(async (ids: string[], _opts?: unknown) => {
      if (Array.isArray(ids) && ids.includes(NEW_MEMBER) && !ids.includes(EXISTING_A)) {
        return [staleNewToken];
      }
      return [];
    });
    mockSendPushNotifications.mockImplementation(
      async (tokens: string[], _payload: unknown, options?: { onStaleToken?: (t: string) => Promise<void> }) => {
        for (const t of tokens) await options?.onStaleToken?.(t);
        return { staleTokens: tokens };
      },
    );

    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockClearPushToken).toHaveBeenCalledWith(staleNewToken);
    });
  });
});
