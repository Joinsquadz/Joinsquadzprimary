import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Push-tap destination for plan invites.
//
// Regression: a PENDING invite (POST /events/:id/invite) grants NO access to
// the plan until the invitee accepts — GET /api/events/:id answers 403 for
// them. The push nevertheless pointed at the plan detail screen, so the tap
// opened a screen that could never load ("blank page with a loading circle").
// Pending invites must route to Activity, where the Accept button lives.
//
// Separately, a trip is stored in the events table but has its own mobile
// detail route, so any plan push must pick screen by event type.
// ---------------------------------------------------------------------------

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInviteTables = vi.hoisted(() => ({
  usersTable: { id: "user_id", moderationHidden: "moderation_hidden" },
  userBlocksTable: { blockerId: "blocker_id", blockedId: "blocked_id" },
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  friendRequestsTable: { id: "request_id", fromUserId: "from_user_id", toUserId: "to_user_id", status: "status" },
  eventInvitesTable: {
    id: "id",
    eventId: "event_id",
    inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id",
    status: "status",
    eventTitle: "event_title",
    eventEmoji: "event_emoji",
    createdAt: "created_at",
  },
}));

vi.mock("@workspace/db", () => {
  const db: any = {
    select: () => ({
        from: (table: unknown) => {
          const where = () => Object.assign(Promise.resolve(
            table === mockInviteTables.usersTable
              ? [{ id: "friend-user-id" }]
              : table === mockInviteTables.friendshipsTable
                ? [{ ownerId: "host-user-id", friendId: "friend-user-id" }]
                : table === mockInviteTables.friendRequestsTable || table === mockInviteTables.eventInvitesTable
                  ? []
                  : mockRows.value,
          ), {
            limit: () => Promise.resolve([]),
            orderBy: () => ({ limit: () => Promise.resolve([]) }),
          });
          return { where, leftJoin: () => ({ where }), orderBy: () => Promise.resolve(mockRows.value) };
        },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: () => Promise.resolve(),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
        returning: () => Promise.resolve(mockUpdateRows.value),
      }),
    }),
  };
  db.transaction = async (callback: (tx: typeof db) => unknown) => callback(db);
  return {
  db,
  eventsTable: {
    id: "id",
    hostId: "host_id",
    rsvps: "rsvps",
    type: "type",
    squadId: "squad_id",
    eventAt: "event_at",
    endAt: "end_at",
    createdAt: "created_at",
    version: "version",
    invitedUserIds: "invited_user_ids",
  },
  ...mockInviteTables,
  eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
  activityTable: {},
  availabilityPollsTable: {},
  };
});

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  countUserEventsThisYear: vi.fn(),
  getEvent: vi.fn(),
  getSquad: vi.fn(),
  getSquadIdsForUser: vi.fn(),
  getFriendIds: vi.fn(),
  getPhotosByEventId: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));
vi.mock("../lib/activity", () => ({
  recordActivitySafe: vi.fn(),
  removeActivity: vi.fn(),
}));

// Router imported statically below the vi.mock calls — see
// .agents/memory/api-server-test-cold-import.md.
import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { makeBaseEvent, HOST_ID } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);
const FRIEND_ID = "friend-user-id";

/** The `data` payload of the first push sent during the test. */
function firstPushData(): Record<string, string> {
  const [, payload] = sendPushNotificationsMock.mock.calls[0] as [
    unknown,
    { data: Record<string, string> },
  ];
  return payload.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRows.value = [];
  mockUpdateRows.value = [];
  storageMock.getUser.mockResolvedValue({ id: HOST_ID, firstName: "Hank", lastName: null, email: "h@x.io" });
  storageMock.upsertUser.mockResolvedValue({ id: HOST_ID });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.getEvent.mockResolvedValue(null);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.getSquadIdsForUser.mockResolvedValue([]);
  storageMock.getFriendIds.mockResolvedValue([FRIEND_ID]);
  storageMock.getPhotosByEventId.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 1, hadSendError: false });
});

describe("POST /api/events/:id/invite — pending-invite push destination", () => {
  it("routes an EVENT invite tap to Activity, not the plan the invitee can't open yet", async () => {
    mockRows.value = [makeBaseEvent()];
    mockUpdateRows.value = [{ id: "invite-1", invitedUserId: FRIEND_ID, eventId: "evt-1" }];

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/invite").send({ userIds: [FRIEND_ID] });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const data = firstPushData();
    // The invitee has no access until they accept, so the plan screen would 403.
    expect(data.screen).toBe("activity");
    expect(data.screen).not.toBe("event");
    // The event id still rides along for context.
    expect(data.eventId).toBe("evt-1");
  });

  it("routes a TRIP invite tap to Activity too (same pending-access rule)", async () => {
    mockRows.value = [makeBaseEvent({ type: "trip" })];
    mockUpdateRows.value = [{ id: "invite-1", invitedUserId: FRIEND_ID, eventId: "evt-1" }];

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/invite").send({ userIds: [FRIEND_ID] });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const data = firstPushData();
    expect(data.screen).toBe("activity");
    expect(data.screen).not.toBe("trip");
  });
});

describe("POST /api/events — create-time invite push destination", () => {
  // Create-time invitees are written straight into invitedUserIds, so they DO
  // have access immediately and should land on the plan itself.

  it("sends a create-time EVENT invitee to the event screen", async () => {
    mockUpdateRows.value = [
      { id: "evt-9", title: "BBQ", emoji: "🔥", squadId: "", hostId: HOST_ID, type: "event", invitedUserIds: [FRIEND_ID] },
    ];

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .post("/api/events")
      .send({ title: "BBQ", emoji: "🔥", date: "TBD", squadId: "", invitedUserIds: [FRIEND_ID] });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const data = firstPushData();
    expect(data.screen).toBe("event");
    expect(data.eventId).toBe("evt-9");
  });

  it("sends a create-time TRIP invitee to the trip screen, not the event screen", async () => {
    mockUpdateRows.value = [
      { id: "trip-9", title: "Tahoe", emoji: "🏔️", squadId: "", hostId: HOST_ID, type: "trip", invitedUserIds: [FRIEND_ID] },
    ];

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .post("/api/events")
      .send({
        title: "Tahoe",
        emoji: "🏔️",
        date: "TBD",
        squadId: "",
        type: "trip",
        // A trip must carry a start date, otherwise the create 400s.
        startAt: "2026-07-01T09:00:00.000Z",
        endAt: "2026-07-04T18:00:00.000Z",
        invitedUserIds: [FRIEND_ID],
      });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const data = firstPushData();
    // Trips share the events table but have their own mobile detail route.
    expect(data.screen).toBe("trip");
    expect(data.eventId).toBe("trip-9");
  });

  it("notifies a squad member who is also directly invited only once", async () => {
    storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [HOST_ID, FRIEND_ID] });
    mockUpdateRows.value = [
      {
        id: "trip-overlap",
        title: "Vegas",
        emoji: "🎰",
        squadId: "squad-1",
        hostId: HOST_ID,
        type: "trip",
        invitedUserIds: [FRIEND_ID],
      },
    ];

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events")
      .send({
        title: "Vegas",
        emoji: "🎰",
        date: "TBD",
        squadId: "squad-1",
        type: "trip",
        startAt: "2026-07-01T09:00:00.000Z",
        endAt: "2026-07-04T18:00:00.000Z",
        invitedUserIds: [FRIEND_ID, FRIEND_ID],
      });

    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledOnce());
    expect(sendPushNotificationsMock).toHaveBeenCalledWith(
      ["ExponentPushToken[a]"],
      expect.objectContaining({ data: { screen: "trip", eventId: "trip-overlap" } }),
      expect.anything(),
    );
  });
});
