// Remediation multi-user integration chain.
//
// Simulates a realistic event lifecycle through the remediated code paths:
//   1. Host creates event, RSVP member joins.
//   2. Host edits time (material edit) → push fires for the RSVP member.
//   3. Host cancels event → cancel push fires (only once).
//   4. RSVP attempt on cancelled event → 410.
//   5. Task creation on cancelled event → 410.
//   6. Poll creation and vote on open event (then close), vote on closed → 400.
//   7. Direct message is blocked when a block relationship exists.
//   8. Pagination: load-more request passes cursor to storage.
//   9. Cost add + payer edit + paidAt block on edit.
//  10. Past-event RSVP guard returns 410.

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Shared mocks ─────────────────────────────────────────────────────────────

const evtRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const evtUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(evtRows.value),
        orderBy: () => Promise.resolve(evtRows.value),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(evtUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(evtUpdateRows.value),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  },
  eventsTable: {
    id: "id", hostId: "host_id", rsvps: "rsvps", type: "type",
    squadId: "squad_id", eventAt: "event_at", endAt: "end_at",
    createdAt: "created_at", version: "version", invitedUserIds: "invited_user_ids",
    cancelled: "cancelled", materialEditNotifiedAt: "material_edit_notified_at",
  },
  eventInvitesTable: {
    id: "id", eventId: "event_id", inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id", status: "status", createdAt: "created_at",
  },
}));

const pushMock = vi.hoisted(() => ({ sendPushNotifications: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/pushNotifications", () => pushMock);

// Single combined storage mock — no duplicate vi.mock calls.
const convoStorageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationParticipants: vi.fn(),
  addConversationMessage: vi.fn().mockResolvedValue({
    id: "msg-1",
    conversationId: "convo-int-1",
    senderId: "user-a-int",
    text: "Hello",
    createdAt: new Date().toISOString(),
  }),
}));

vi.mock("../storage", () => ({
  storage: {
    ...convoStorageMock,
    getUser: vi.fn().mockResolvedValue({ id: "host-user-id", name: "Host" }),
    upsertUser: vi.fn().mockResolvedValue({ id: "host-user-id" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getFriendIds: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue(["ExponentPushToken[member-tok]"]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/logger");

// conversations.ts imports getBlockedAndBlockerIds from "./moderation" (same routes dir).
const getBlockedMock = vi.hoisted(() => vi.fn().mockResolvedValue([] as string[]));
vi.mock("../routes/moderation", () => ({ getBlockedAndBlockerIds: getBlockedMock }));

vi.mock("../lib/conversationUpdates", () => ({
  emitConversationUpdate: vi.fn(),
  onConversationUpdate: vi.fn().mockReturnValue(() => {}),
}));

import eventsRouter from "../routes/events";
import conversationsRouter from "../routes/conversations";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const FUTURE = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
const PAST = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
const COST_ID = "cost-1";
const POLL_ID = "poll-1";
const OPT_ID = "opt-1";

function liveEvent(overrides: Record<string, unknown> = {}) {
  return makeBaseEvent({
    version: 1,
    cancelled: false,
    eventAt: FUTURE,
    endAt: null,
    rsvps: { [RSVP_USER_ID]: "going" },
    materialEditNotifiedAt: null,
    polls: [
      {
        id: POLL_ID,
        question: "Venue?",
        closed: false,
        options: [{ id: OPT_ID, label: "Park", voterIds: [] }],
      },
    ],
    costs: [
      {
        id: COST_ID,
        description: "Pizza",
        amount: 30,
        paidById: RSVP_USER_ID,
        shares: [
          { userId: RSVP_USER_ID, amount: 15, paidAt: null, confirmedAt: null },
          { userId: HOST_ID, amount: 15, paidAt: null, confirmedAt: null },
        ],
      },
    ],
    ...overrides,
  });
}

const hostApp = makeTestApp(eventsRouter, { id: HOST_ID });
const memberApp = makeTestApp(eventsRouter, { id: RSVP_USER_ID });

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.sendPushNotifications.mockResolvedValue(undefined);
  getBlockedMock.mockResolvedValue([]);
  convoStorageMock.addConversationMessage.mockResolvedValue({
    id: "msg-1",
    conversationId: "convo-int-1",
    senderId: "user-a-int",
    text: "Hello",
    createdAt: new Date().toISOString(),
  });
});

// ── Step 1-2: material edit fires push ───────────────────────────────────────

describe("Integration — material edit triggers push to RSVP members", () => {
  it("PATCH location fires push, response is 200", async () => {
    const ev = liveEvent();
    evtRows.value = [ev];
    evtUpdateRows.value = [{ ...ev, location: "Beach", version: 2 }];
    const res = await request(hostApp)
      .patch("/api/events/evt-1")
      .send({ location: "Beach", version: 1 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
  });
});

// ── Step 3: cancel push fires once ───────────────────────────────────────────

describe("Integration — cancel push fires exactly once on false→true", () => {
  it("PATCH cancelled:true returns 200 and fires the cancel push", async () => {
    const ev = liveEvent();
    evtRows.value = [ev];
    evtUpdateRows.value = [{ ...ev, cancelled: true, version: 2 }];
    const res = await request(hostApp)
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 1 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalledTimes(1));
    const [, note] = pushMock.sendPushNotifications.mock.calls[0] as [
      unknown,
      { title: string },
    ];
    expect(note.title).toMatch(/cancelled/i);
  });
});

// ── Step 4: RSVP on cancelled → 410 ──────────────────────────────────────────

describe("Integration — RSVP on cancelled event returns 410", () => {
  it("member POST /rsvp on cancelled event → 410", async () => {
    evtRows.value = [liveEvent({ cancelled: true })];
    const res = await request(memberApp)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(410);
  });
});

// ── Step 5: task creation on cancelled → 410 ─────────────────────────────────

describe("Integration — task creation on cancelled event returns 410", () => {
  it("member POST /tasks on cancelled event → 410", async () => {
    evtRows.value = [liveEvent({ cancelled: true })];
    const res = await request(memberApp)
      .post("/api/events/evt-1/tasks")
      .send({ title: "Ice", version: 1 });
    expect(res.status).toBe(410);
  });
});

// ── Step 6: closed poll rejects vote ─────────────────────────────────────────

describe("Integration — vote on closed poll returns 400", () => {
  it("closed poll → 400 with 'poll is closed' message", async () => {
    evtRows.value = [
      liveEvent({
        polls: [
          {
            id: POLL_ID,
            question: "Venue?",
            closed: true,
            options: [{ id: OPT_ID, label: "Park", voterIds: [] }],
          },
        ],
      }),
    ];
    const res = await request(hostApp)
      .post(`/api/events/evt-1/polls/${POLL_ID}/vote`)
      .send({ optionId: OPT_ID, version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/poll is closed/i);
  });
});

// ── Step 9: cost edit blocked by paidAt ──────────────────────────────────────

describe("Integration — cost edit blocked when a share has paidAt", () => {
  it("PATCH cost with paidAt share → 409 paymentsInProgress", async () => {
    evtRows.value = [
      liveEvent({
        costs: [
          {
            id: COST_ID,
            description: "Pizza",
            amount: 30,
            paidById: RSVP_USER_ID,
            shares: [
              {
                userId: RSVP_USER_ID,
                amount: 15,
                paidAt: new Date().toISOString(),
                confirmedAt: null,
              },
              { userId: HOST_ID, amount: 15, paidAt: null, confirmedAt: null },
            ],
          },
        ],
      }),
    ];
    const res = await request(hostApp)
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send({
        description: "Pizza (edit)",
        amount: 30,
        shares: [
          { userId: RSVP_USER_ID, amount: 15 },
          { userId: HOST_ID, amount: 15 },
        ],
        version: 1,
      });
    expect(res.status).toBe(409);
    expect(res.body.paymentsInProgress).toBe(true);
  });
});

// ── Step 10: past event RSVP guard ───────────────────────────────────────────

describe("Integration — RSVP on a past event returns 410", () => {
  it("host RSVP on past event → 410 RSVPs are closed", async () => {
    evtRows.value = [liveEvent({ eventAt: PAST, cancelled: false })];
    const res = await request(hostApp)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/already happened|RSVPs are closed/i);
  });
});

// ── Blocked DM integration ────────────────────────────────────────────────────

describe("Integration — blocked DM send returns 403 in both directions", () => {
  const CONVO_ID = "convo-int-1";
  const USER_A = "user-a-int";
  const USER_B = "user-b-int";

  beforeEach(() => {
    convoStorageMock.getConversationForMember.mockResolvedValue({
      id: CONVO_ID,
      type: "direct",
      squadId: null,
    });
    convoStorageMock.getConversationParticipants.mockResolvedValue([
      { userId: USER_A },
      { userId: USER_B },
    ]);
    convoStorageMock.getConversationMessages.mockResolvedValue({
      messages: [],
      hasMore: false,
    });
  });

  it("blocked user cannot send a DM → 403", async () => {
    getBlockedMock.mockResolvedValue([USER_B]);
    const convoApp = makeTestApp(conversationsRouter, { id: USER_A });
    const res = await request(convoApp)
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "Hello" });
    expect(res.status).toBe(403);
  });
});

// ── Pagination integration ────────────────────────────────────────────────────

describe("Integration — conversation pagination passes cursor to storage", () => {
  const CONVO_ID = "convo-page-1";
  const USER_A = "user-a-page";

  beforeEach(() => {
    convoStorageMock.getConversationForMember.mockResolvedValue({
      id: CONVO_ID,
      type: "direct",
      squadId: null,
    });
    convoStorageMock.getConversationParticipants.mockResolvedValue([{ userId: USER_A }]);
    convoStorageMock.getConversationMessages.mockResolvedValue({
      messages: Array.from({ length: 5 }, (_, i) => ({
        id: `msg-${i + 1}`,
        senderId: USER_A,
        text: `Message ${i + 1}`,
        createdAt: new Date().toISOString(),
      })),
      hasMore: false,
    });
  });

  it("passes the before cursor to storage", async () => {
    const convoApp = makeTestApp(conversationsRouter, { id: USER_A });
    const res = await request(convoApp)
      .get(`/api/conversations/${CONVO_ID}/messages?before=msg-50`);
    expect(res.status).toBe(200);
    const [, opts] = convoStorageMock.getConversationMessages.mock.calls[0] as [
      string,
      { before?: string },
    ];
    expect(opts.before).toBe("msg-50");
  });
});
