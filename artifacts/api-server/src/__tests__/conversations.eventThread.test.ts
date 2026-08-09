// Plan (event / trip) chat threads — the replacement for the old
// POST /api/events/:id/messages embedded-JSON endpoint.
//
// Covers the behaviour that used to live in the events router:
//   - opening a thread is gated on CURRENT plan visibility (host / invitee /
//     squad member / RSVP), not on a stale participant row;
//   - a cancelled plan closes its chat (410), same as the other sub-resources;
//   - sending re-syncs the audience so a newly-added squadmate is reachable;
//   - a chat send NEVER touches the parent event's optimistic-concurrency
//     version (the whole point of the migration);
//   - push taps route to the event/trip detail screen, not the generic
//     conversation screen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getOrCreateEventConversation: vi.fn(),
  getConversationForMember: vi.fn(),
  getConversationParticipants: vi.fn(),
  getConversationMessages: vi.fn(),
  addConversationMessage: vi.fn(),
  syncEventConversationParticipants: vi.fn(),
  canUserAccessEventRecord: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getEvent: vi.fn(),
  getUser: vi.fn(),
  getUploadOwner: vi.fn(),
  getNotificationPrefs: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
}));

const pushMock = vi.hoisted(() => ({ sendPushNotifications: vi.fn() }));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/pushNotifications", () => pushMock);
vi.mock("../lib/logger");
vi.mock("@workspace/db", () => ({ db: {}, conversationsTable: {} }));
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));

import conversationsRouter from "../routes/conversations";
import { makeTestApp } from "./helpers/makeTestApp";

const HOST_ID = "user-host";
const MEMBER_ID = "user-member";
const STRANGER_ID = "user-stranger";
const EVENT_ID = "evt-1";
const CONVO_ID = "convo-evt-1";

const EVENT_CONVO = { id: CONVO_ID, type: "event", squadId: null, eventId: EVENT_ID };

const PLAN = {
  id: EVENT_ID,
  type: "event",
  title: "Taco night",
  hostId: HOST_ID,
  squadId: "squad-1",
  cancelled: false,
  version: 7,
};

const makeApp = (userId = HOST_ID) => makeTestApp(conversationsRouter, { id: userId });

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getConversationForMember.mockResolvedValue(EVENT_CONVO);
  storageMock.getConversationParticipants.mockResolvedValue([
    { userId: HOST_ID },
    { userId: MEMBER_ID },
  ]);
  storageMock.getConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
  storageMock.addConversationMessage.mockResolvedValue({
    id: "m1",
    conversationId: CONVO_ID,
    senderId: HOST_ID,
    text: "hi",
    attachments: [],
    createdAt: new Date().toISOString(),
  });
  storageMock.syncEventConversationParticipants.mockResolvedValue(undefined);
  storageMock.getEvent.mockResolvedValue(PLAN);
  storageMock.canUserAccessEventRecord.mockResolvedValue(true);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getUser.mockResolvedValue({ id: HOST_ID, firstName: "Ada", lastName: "L" });
  storageMock.getNotificationPrefs.mockResolvedValue({ messages: true });
  storageMock.getPushTokensForUsers.mockResolvedValue([{ userId: MEMBER_ID, token: "tok-1" }]);
  pushMock.sendPushNotifications.mockResolvedValue(undefined);
});

// ── Opening the thread ────────────────────────────────────────────────────────

describe("GET /api/conversations/event/:eventId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeTestApp(conversationsRouter)).get(
      `/api/conversations/event/${EVENT_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("returns the thread id for someone who can see the plan", async () => {
    storageMock.getOrCreateEventConversation.mockResolvedValue(EVENT_CONVO);
    const res = await request(makeApp()).get(`/api/conversations/event/${EVENT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(CONVO_ID);
    expect(storageMock.getOrCreateEventConversation).toHaveBeenCalledWith(EVENT_ID, HOST_ID);
  });

  it("returns 403 for a stranger (storage refuses to hand back a thread)", async () => {
    storageMock.getOrCreateEventConversation.mockResolvedValue(null);
    const res = await request(makeApp(STRANGER_ID)).get(`/api/conversations/event/${EVENT_ID}`);
    expect(res.status).toBe(403);
  });
});

// ── Sending ───────────────────────────────────────────────────────────────────

describe("POST /api/conversations/:id/messages — plan threads", () => {
  it("returns 403 when the user can no longer see the plan", async () => {
    storageMock.getConversationForMember.mockResolvedValue(null);
    const res = await request(makeApp(STRANGER_ID))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "let me in" });
    expect(res.status).toBe(403);
  });

  it("returns 410 when the plan has been cancelled (chat closes with the plan)", async () => {
    storageMock.getEvent.mockResolvedValue({ ...PLAN, cancelled: true });
    const res = await request(makeApp())
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "still on?" });
    expect(res.status).toBe(410);
    expect(storageMock.addConversationMessage).not.toHaveBeenCalled();
  });

  it("re-syncs the plan audience before sending so new squadmates are reachable", async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "hi" });
    expect(res.status).toBe(201);
    expect(storageMock.syncEventConversationParticipants).toHaveBeenCalledWith(CONVO_ID, EVENT_ID);
  });

  it("sends via the conversation store and never bumps the parent event version", async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "hi" });
    expect(res.status).toBe(201);
    expect(storageMock.addConversationMessage).toHaveBeenCalled();
    // The only event write path in this router would be an update helper; the
    // plan is read (for cancelled/audience checks) but never written.
    expect(storageMock.getEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(Object.keys(storageMock)).not.toContain("updateEvent");
  });

  it("accepts a body with no version field (chat has no optimistic-concurrency contract)", async () => {
    const res = await request(makeApp())
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "no version here" });
    expect(res.status).toBe(201);
  });
});

// ── Push fan-out ──────────────────────────────────────────────────────────────

describe("plan-chat push fan-out", () => {
  const flush = () => new Promise((r) => setImmediate(r));

  it("routes the tap to the event detail screen with the chat tab selected", async () => {
    await request(makeApp()).post(`/api/conversations/${CONVO_ID}/messages`).send({ text: "hi" });
    await flush();
    expect(pushMock.sendPushNotifications).toHaveBeenCalled();
    const payload = pushMock.sendPushNotifications.mock.calls[0][1];
    expect(payload.data).toEqual({ screen: "event", eventId: EVENT_ID, tab: "chat" });
  });

  it("routes trip chat to the trip screen", async () => {
    storageMock.getEvent.mockResolvedValue({ ...PLAN, type: "trip" });
    await request(makeApp()).post(`/api/conversations/${CONVO_ID}/messages`).send({ text: "hi" });
    await flush();
    const payload = pushMock.sendPushNotifications.mock.calls[0][1];
    expect(payload.data).toEqual({ screen: "trip", eventId: EVENT_ID, tab: "chat" });
  });

  it("drops recipients who have since lost access to the plan", async () => {
    // MEMBER_ID still has a (never-pruned) participant row but can no longer
    // see the plan — they must not receive the push.
    storageMock.canUserAccessEventRecord.mockResolvedValue(false);
    await request(makeApp()).post(`/api/conversations/${CONVO_ID}/messages`).send({ text: "hi" });
    await flush();
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("honours the mute on the squad the plan belongs to", async () => {
    storageMock.filterUnmutedForSquad.mockResolvedValue([]);
    await request(makeApp()).post(`/api/conversations/${CONVO_ID}/messages`).send({ text: "hi" });
    await flush();
    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith([MEMBER_ID], "squad-1");
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });
});

// ── Thread metadata ───────────────────────────────────────────────────────────

describe("GET /api/conversations/:id/messages — plan thread metadata", () => {
  it("exposes eventId on the conversation so the client can route back to the plan", async () => {
    const res = await request(makeApp()).get(`/api/conversations/${CONVO_ID}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.conversation).toMatchObject({ type: "event", eventId: EVENT_ID });
  });
});
