import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const HOST_ID = "host-user";
const TARGET_ID = "target-user";

const tables = vi.hoisted(() => ({
  eventsTable: {
    id: "events.id",
    hostId: "events.host_id",
    rsvps: "events.rsvps",
    type: "events.type",
    squadId: "events.squad_id",
    eventAt: "events.event_at",
    endAt: "events.end_at",
    createdAt: "events.created_at",
    version: "events.version",
    invitedUserIds: "events.invited_user_ids",
  },
  usersTable: { id: "users.id", moderationHidden: "users.moderation_hidden" },
  userBlocksTable: { blockerId: "blocks.blocker_id", blockedId: "blocks.blocked_id" },
  friendshipsTable: { ownerId: "friendships.owner_id", friendId: "friendships.friend_id" },
  friendRequestsTable: {
    id: "requests.id",
    fromUserId: "requests.from_user_id",
    toUserId: "requests.to_user_id",
    status: "requests.status",
    createdAt: "requests.created_at",
  },
  eventInvitesTable: {
    id: "event_invites.id",
    eventId: "event_invites.event_id",
    inviterUserId: "event_invites.inviter_user_id",
    invitedUserId: "event_invites.invited_user_id",
    status: "event_invites.status",
    eventTitle: "event_invites.event_title",
    eventEmoji: "event_invites.event_emoji",
    createdAt: "event_invites.created_at",
  },
  eventCreationsTable: {},
  activityTable: {},
  availabilityPollsTable: {},
}));

const state = vi.hoisted(() => ({
  event: {
    id: "event-1",
    title: "Dinner",
    emoji: "🍝",
    type: "event",
    hostId: "host-user",
    squadId: "",
    invitedUserIds: [] as string[],
    rsvps: {},
    cancelled: false,
    version: 1,
  },
  users: [] as Array<{ id: string }>,
  blocks: [] as Array<{ blockerId: string; blockedId: string }>,
  friendships: [] as Array<{ ownerId: string; friendId: string }>,
  requests: [] as Array<{ id: string; fromUserId: string; toUserId: string; status: string }>,
  eventInvites: [] as Array<Record<string, unknown>>,
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  activities: [] as Array<Record<string, unknown>>,
  pushes: [] as unknown[][],
}));

function rowsFor(table: unknown): unknown[] {
  if (table === tables.eventsTable) return [state.event];
  if (table === tables.usersTable) return state.users;
  if (table === tables.userBlocksTable) return state.blocks;
  if (table === tables.friendshipsTable) return state.friendships;
  if (table === tables.friendRequestsTable) return state.requests;
  if (table === tables.eventInvitesTable) return state.eventInvites;
  return [];
}

function queryResult(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    limit: (count: number) => Promise.resolve(rows.slice(0, count)),
  };
}

vi.mock("@workspace/db", () => {
  const executor = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => queryResult(rowsFor(table)),
        orderBy: () => queryResult(rowsFor(table)),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        state.insertCalls.push({ table, values });
        if (table === tables.eventInvitesTable) {
          const invite = {
            id: "event-invite-1",
            eventId: "event-1",
            inviterUserId: "host-user",
            invitedUserId: TARGET_ID,
            status: "pending",
          };
          if (!state.eventInvites.some((row) => row.invitedUserId === TARGET_ID)) {
            state.eventInvites.push(invite);
          }
          return {
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve([invite]) }),
            returning: () => Promise.resolve([invite]),
          };
        }
        const request = {
          id: "friend-request-1",
          fromUserId: "host-user",
          toUserId: TARGET_ID,
          status: "pending",
        };
        state.requests.push(request);
        return {
          onConflictDoUpdate: () => ({ returning: () => Promise.resolve([request]) }),
          returning: () => Promise.resolve([request]),
        };
      },
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    execute: () => Promise.resolve(),
  };
  return { db: { ...executor, transaction: async (callback: (tx: typeof executor) => unknown) => callback(executor) }, ...tables };
});

vi.mock("../storage", () => ({
  storage: {
    getSquad: vi.fn().mockResolvedValue(null),
    getPushTokensForUsers: vi.fn().mockResolvedValue(["ExponentPushToken[test]"]),
    getUser: vi.fn().mockResolvedValue({ id: "host-user", firstName: "Host", lastName: null }),
    clearPushToken: vi.fn(),
  },
}));
vi.mock("../lib/activity", () => ({
  recordActivitySafe: (activity: Record<string, unknown>) => state.activities.push(activity),
  removeActivity: vi.fn(),
}));
vi.mock("../lib/activityEvents", () => ({ emitActivityUpdate: vi.fn() }));
vi.mock("../lib/eventUpdates", () => ({ emitEventUpdate: vi.fn(), onEventUpdate: vi.fn() }));
vi.mock("../lib/eventVisibility", () => ({
  canUserAccessEventRecord: (event: typeof state.event, userId: string) =>
    event.hostId === userId || event.invitedUserIds.includes(userId),
}));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: (...args: unknown[]) => {
    state.pushes.push(args);
    return Promise.resolve();
  },
}));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";

function inviteApp() {
  return makeTestApp(eventsRouter, { id: HOST_ID });
}

beforeEach(() => {
  state.users = [{ id: TARGET_ID }];
  state.blocks = [];
  state.friendships = [];
  state.requests = [];
  state.eventInvites = [];
  state.insertCalls = [];
  state.activities = [];
  state.pushes = [];
  state.event.invitedUserIds = [];
});

describe("POST /api/events/:id/invite for discoverable non-friends", () => {
  it("creates one pending event invite and one pending outgoing friend request", async () => {
    const res = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: [TARGET_ID] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      requestedCount: 1,
      inviteCount: 1,
      friendRequestCount: 1,
    });
    expect(state.eventInvites).toHaveLength(1);
    expect(state.requests).toEqual([
      expect.objectContaining({
        fromUserId: HOST_ID,
        toUserId: TARGET_ID,
        status: "pending",
      }),
    ]);
    expect(state.friendships).toHaveLength(0);
    expect(state.activities.map((activity) => activity.type)).toEqual(
      expect.arrayContaining(["event_invite", "friend_request"]),
    );
    await vi.waitFor(() => expect(state.pushes).toHaveLength(2));
  });

  it("is idempotent when retried with an existing pending invite and request", async () => {
    const first = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: [TARGET_ID] });
    expect(first.status).toBe(200);
    state.activities = [];
    await vi.waitFor(() => expect(state.pushes).toHaveLength(2));
    state.pushes = [];

    const second = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: [TARGET_ID] });

    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ inviteCount: 0, friendRequestCount: 0, alreadyPendingCount: 1 });
    expect(state.eventInvites).toHaveLength(1);
    expect(state.requests).toHaveLength(1);
    expect(state.activities).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.pushes).toEqual([]);
  });

  it.each([
    { label: "blocked", blocks: [{ blockerId: HOST_ID, blockedId: TARGET_ID }], users: [{ id: TARGET_ID }] },
    { label: "moderation-hidden", blocks: [], users: [] },
  ])("creates neither record for a $label target", async ({ blocks, users }) => {
    state.blocks = blocks;
    state.users = users;

    const res = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: [TARGET_ID] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inviteCount: 0, friendRequestCount: 0 });
    expect(res.body.blockedCount).toBeUndefined();
    expect(res.body.statuses).toContainEqual({ userId: TARGET_ID, status: "skipped" });
    expect(state.eventInvites).toHaveLength(0);
    expect(state.requests).toHaveLength(0);
  });

  it("rejects batches larger than the endpoint limit", async () => {
    const res = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: Array.from({ length: 26 }, (_, index) => `user-${index}`) });

    expect(res.status).toBe(400);
    expect(state.insertCalls).toEqual([]);
  });

  it("does not auto-accept or duplicate an opposite-direction pending request", async () => {
    state.requests = [{
      id: "incoming-1",
      fromUserId: TARGET_ID,
      toUserId: HOST_ID,
      status: "pending",
    }];

    const res = await request(inviteApp())
      .post("/api/events/event-1/invite")
      .send({ userIds: [TARGET_ID] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inviteCount: 1, friendRequestCount: 0 });
    expect(res.body.statuses).toContainEqual({
      userId: TARGET_ID,
      status: "incoming_pending",
    });
    expect(state.requests).toEqual([expect.objectContaining({
      id: "incoming-1",
      status: "pending",
    })]);
    expect(state.friendships).toHaveLength(0);
  });
});