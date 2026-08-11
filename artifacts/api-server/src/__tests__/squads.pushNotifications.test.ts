import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
// When non-empty, each select consumes the next entry (FIFO); otherwise
// mockSelectRows.value is returned. Lets tests script multi-select routes.
const mockSelectQueue = vi.hoisted(() => ({ value: [] as unknown[][] }));
const mockUpdateSetArgs = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockOnConflictArgs = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertError = vi.hoisted(() => ({ value: null as Error | null }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(mockSelectQueue.value.length > 0 ? mockSelectQueue.value.shift() : mockSelectRows.value),
        orderBy: () =>
          Promise.resolve(mockSelectQueue.value.length > 0 ? mockSelectQueue.value.shift() : mockSelectRows.value),
      }),
    }),
    update: () => ({
      set: (vals: unknown) => {
        mockUpdateSetArgs.value.push(vals);
        return {
          where: () => ({
            returning: () => Promise.resolve(mockUpdateRows.value),
          }),
        };
      },
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () =>
          mockInsertError.value ? Promise.reject(mockInsertError.value) : Promise.resolve(mockInsertRows.value),
        onConflictDoUpdate: (args: unknown) => {
          mockOnConflictArgs.value.push(args);
          return {
            returning: () =>
              mockInsertError.value ? Promise.reject(mockInsertError.value) : Promise.resolve(mockInsertRows.value),
          };
        },
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(mockInsertRows.value),
        }),
      }),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: () => Promise.resolve(),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockSelectRows.value),
            orderBy: () => Promise.resolve(mockSelectRows.value),
          }),
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve(mockInsertRows.value),
            // #633: squad_member_history ledger write shares this tx.
            onConflictDoNothing: () => Promise.resolve(undefined),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
          }),
        }),
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
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
  activityTable: { id: "id", recipientId: "recipient_id" },
  eventsTable: { id: "id", squadId: "squad_id", version: "version", itinerary: "itinerary", polls: "polls", rsvps: "rsvps" },
  eventInvitesTable: { eventId: "event_id" },
  conversationsTable: { id: "id", squadId: "squad_id" },
  photosTable: { squadId: "squad_id", sharedToSquad: "shared_to_squad" },
  availabilityPollsTable: { squadId: "squad_id" },
  squadMemberHistoryTable: { squadId: "squad_id", userId: "user_id", firstJoinedAt: "first_joined_at" },
  eventCreationsTable: { id: "id", userId: "user_id", eventId: "event_id", source: "source", createdAt: "created_at" },
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

vi.mock("../lib/logger", () => ({ logger: { error: (...a: unknown[]) => console.error("LOGERR", ...a), info: () => {}, warn: () => {}, debug: () => {}, child: () => ({ error: () => {}, info: () => {}, warn: () => {}, debug: () => {} }) } }));

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
  creatorId: CREATOR_ID,
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

  it("fetches push tokens only for invited members, not the creator", async () => {
    mockSelectRows.value = [{ id: MEMBER_A }, { id: MEMBER_B }];
    const app = makeApp({ id: CREATOR_ID });
    await request(app)
      .post("/api/squads")
      .send({ name: "Weekend Crew", memberIds: [MEMBER_A, MEMBER_B] });

    await vi.waitFor(() => {
      expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([MEMBER_A, MEMBER_B], { requireNotifySquadJoin: true });
  });

  it("sends a squad-invite push (consent model: invitees are invited, not added)", async () => {
    mockSelectRows.value = [{ id: MEMBER_A }, { id: MEMBER_B }];
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
        title: "Squad invite",
        body: `Someone invited you to join "${BASE_SQUAD.name}"`,
        data: { screen: "activity" },
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
    mockSelectRows.value = [{ id: MEMBER_A }];
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
    mockSelectRows.value = [{ id: MEMBER_A }];
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
    mockSelectRows.value = [{ id: MEMBER_A }, { id: MEMBER_B }];
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

  it("skips sendPushNotifications entirely when all invited members opted out", async () => {
    mockSelectRows.value = [{ id: MEMBER_A }, { id: MEMBER_B }];
    // Storage layer returns [] because all invited members set notifySquadJoin=false
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

    // With zero tokens the invite push short-circuits — no delivery attempt.
    await new Promise((r) => setImmediate(r));
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
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

describe("PATCH /api/squads/:id — memberIds additions become pending invites", () => {
  const ACTOR_ID = "actor-user-id";
  const EXISTING_A = "existing-member-a";
  const EXISTING_B = "existing-member-b";
  const NEW_MEMBER = "new-member-id";
  const TOKEN_NEW = "ExponentPushToken[new-member]";

  const existingSquad = {
    id: "squad-patch-1",
    name: "Patch Squad",
    emoji: "👥",
    color: "#FF5C3A",
    creatorId: ACTOR_ID,
    memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B],
    createdAt: new Date().toISOString(),
  };

  // The persisted update never contains the new member — additions are
  // stripped and turned into pending invites instead.
  const updatedSquad = { ...existingSquad, version: 2 };

  const inviteRow = {
    id: "invite-1",
    squadId: existingSquad.id,
    inviterUserId: ACTOR_ID,
    invitedUserId: NEW_MEMBER,
    squadName: existingSquad.name,
    squadEmoji: existingSquad.emoji,
    status: "pending",
  };

  beforeEach(() => {
    mockSelectRows.value = [existingSquad];
    // Selects in order: squad lookup → target users lookup → existing pending invites.
    mockSelectQueue.value = [[existingSquad], [{ id: NEW_MEMBER }], []];
    mockUpdateRows.value = [updatedSquad];
    mockUpdateSetArgs.value = [];
    mockOnConflictArgs.value = [];
    mockInsertError.value = null;
    mockInsertRows.value = [inviteRow];
    mockGetUser.mockResolvedValue({ firstName: "Alice", lastName: "Smith" });
    mockGetPushTokensForUsers.mockResolvedValue([TOKEN_NEW]);
  });

  it("returns 200, strips the addition from the persisted memberIds, and reports it as a pending invite", async () => {
    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-patch-1");
    expect(res.body.pendingInvitedUserIds).toEqual([NEW_MEMBER]);
    // The direct memberIds write must not include the added user.
    const setCall = mockUpdateSetArgs.value.find(
      (v) => typeof v === "object" && v !== null && "memberIds" in (v as Record<string, unknown>),
    ) as { memberIds: string[] } | undefined;
    expect(setCall).toBeDefined();
    expect(setCall!.memberIds).toEqual([ACTOR_ID, EXISTING_A, EXISTING_B]);
    expect(setCall!.memberIds).not.toContain(NEW_MEMBER);
  });

  it("sends a Squad invite push to the invitee (no direct-add notification)", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    expect(mockGetPushTokensForUsers).toHaveBeenCalledWith([NEW_MEMBER], { requireNotifySquadJoin: true });
    expect(mockSendPushNotifications).toHaveBeenCalledWith(
      [TOKEN_NEW],
      {
        title: "Squad invite",
        body: `Alice Smith invited you to join "${existingSquad.name}"`,
        data: { screen: "activity" },
      },
      expect.objectContaining({ onStaleToken: expect.any(Function) }),
    );
  });

  it("does not notify existing members about the invite", async () => {
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    // Only the invitee's tokens are fetched — never the existing members'.
    expect(mockGetPushTokensForUsers).toHaveBeenCalledTimes(1);
    const calledWith = mockGetPushTokensForUsers.mock.calls[0][0] as string[];
    expect(calledWith).toEqual([NEW_MEMBER]);
  });

  it("uses 'Someone' in the invite push when the actor has no name", async () => {
    mockGetUser.mockResolvedValue(null);

    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    await vi.waitFor(() => {
      expect(mockSendPushNotifications).toHaveBeenCalledTimes(1);
    });

    const payload = mockSendPushNotifications.mock.calls[0][1] as { body: string };
    expect(payload.body).toContain("Someone");
  });

  it("rejects member additions from a non-manager when membersCanInvite is false", async () => {
    const lockedSquad = { ...existingSquad, creatorId: "someone-else", membersCanInvite: false };
    mockSelectRows.value = [lockedSquad];
    mockSelectQueue.value = [[lockedSquad]];

    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    expect(res.status).toBe(403);
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("re-invites via upsert: a prior declined invite is reopened instead of colliding", async () => {
    // The declined row is NOT returned by the pending-only dedupe select, so the
    // insert must go through onConflictDoUpdate to reopen it as pending.
    mockSelectQueue.value = [[existingSquad], [{ id: NEW_MEMBER }], []];

    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    expect(res.status).toBe(200);
    expect(res.body.pendingInvitedUserIds).toEqual([NEW_MEMBER]);
    expect(mockOnConflictArgs.value).toHaveLength(1);
    const conflictArg = mockOnConflictArgs.value[0] as { set?: { status?: string } };
    expect(conflictArg.set?.status).toBe("pending");
  });

  it("returns 500 (not a false success) when invite creation fails unexpectedly", async () => {
    mockInsertError.value = new Error("db down");

    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    expect(res.status).toBe(500);

    await new Promise((r) => setImmediate(r));
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("skips invitees who already have a pending invite (no duplicate invite, no push)", async () => {
    mockSelectQueue.value = [[existingSquad], [{ id: NEW_MEMBER }], [{ invitedUserId: NEW_MEMBER }]];

    const app = makeApp({ id: ACTOR_ID });
    const res = await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B, NEW_MEMBER] });

    expect(res.status).toBe(200);
    expect(res.body.pendingInvitedUserIds).toEqual([]);

    await new Promise((r) => setImmediate(r));
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not send notifications when memberIds is not in the request body", async () => {
    mockSelectQueue.value = [[existingSquad]];
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ name: "Renamed Squad" });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not send notifications when memberIds contains no new members", async () => {
    mockSelectQueue.value = [[existingSquad]];
    const app = makeApp({ id: ACTOR_ID });
    await request(app)
      .patch("/api/squads/squad-patch-1")
      .send({ memberIds: [ACTOR_ID, EXISTING_A, EXISTING_B] });

    await new Promise((r) => setImmediate(r));

    expect(mockGetPushTokensForUsers).not.toHaveBeenCalled();
    expect(mockSendPushNotifications).not.toHaveBeenCalled();
  });

  it("cleans up stale tokens from the invite notification via clearPushToken", async () => {
    const staleToken = "ExponentPushToken[stale-invite]";
    mockGetPushTokensForUsers.mockResolvedValue([staleToken]);
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
      expect(mockClearPushToken).toHaveBeenCalledWith(staleToken);
    });
  });
});
