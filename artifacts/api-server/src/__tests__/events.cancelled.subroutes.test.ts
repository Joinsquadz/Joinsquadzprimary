// A3 — cancelled-event guard: every mutating sub-resource route must return 410
// when `event.cancelled` is true. The server helper `getEventAsMemberForWrite`
// enforces this before any write is attempted.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
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
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
      }),
    }),
  },
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
    cancelled: "cancelled",
  },
  eventInvitesTable: {
    id: "id",
    eventId: "event_id",
    inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id",
    status: "status",
    createdAt: "created_at",
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getFriendIds: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = (userId = HOST_ID) => makeTestApp(eventsRouter, { id: userId });

const cancelledEvent = makeBaseEvent({
  cancelled: true,
  version: 0,
  polls: [
    {
      id: "poll-1",
      question: "Where?",
      closed: false,
      options: [{ id: "opt-1", label: "Pizza", voterIds: [] }],
    },
  ],
  costs: [],
  messages: [],
  tasks: [],
});

beforeEach(() => {
  mockRows.value = [cancelledEvent];
  mockUpdateRows.value = [cancelledEvent];
});

// ── Task creation ─────────────────────────────────────────────────────────────

describe("A3 — POST /api/events/:id/tasks on a cancelled event", () => {
  it("returns 410 when the host tries to add a task", async () => {
    const res = await request(makeApp())
      .post("/api/events/evt-1/tasks")
      .send({ title: "Buy ice", version: 0 });
    expect(res.status).toBe(410);
  });

  it("returns 410 when an RSVP'd member tries to add a task", async () => {
    const res = await request(makeApp(RSVP_USER_ID))
      .post("/api/events/evt-1/tasks")
      .send({ title: "Bring cups", version: 0 });
    expect(res.status).toBe(410);
  });
});

// ── Cost creation ─────────────────────────────────────────────────────────────

describe("A3 — POST /api/events/:id/costs on a cancelled event", () => {
  it("returns 410 when the host tries to add a cost", async () => {
    const res = await request(makeApp())
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 30,
        paidById: HOST_ID,
        shares: [{ userId: HOST_ID, amount: 30 }],
        version: 0,
      });
    expect(res.status).toBe(410);
  });

  it("returns 410 when an RSVP'd member tries to add a cost", async () => {
    const res = await request(makeApp(RSVP_USER_ID))
      .post("/api/events/evt-1/costs")
      .send({
        description: "Drinks",
        amount: 20,
        paidById: RSVP_USER_ID,
        shares: [{ userId: RSVP_USER_ID, amount: 20 }],
        version: 0,
      });
    expect(res.status).toBe(410);
  });
});

// ── Poll creation ─────────────────────────────────────────────────────────────

describe("A3 — POST /api/events/:id/polls on a cancelled event", () => {
  it("returns 410 when the host tries to create a poll", async () => {
    const res = await request(makeApp())
      .post("/api/events/evt-1/polls")
      .send({
        question: "What time?",
        options: ["8pm", "9pm"],
        version: 0,
      });
    expect(res.status).toBe(410);
  });
});

// ── Poll vote ─────────────────────────────────────────────────────────────────

describe("A3 — POST /api/events/:id/polls/:pollId/vote on a cancelled event", () => {
  it("returns 410 when the host tries to vote", async () => {
    const res = await request(makeApp())
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(res.status).toBe(410);
  });

  it("returns 410 when an RSVP'd member tries to vote", async () => {
    const res = await request(makeApp(RSVP_USER_ID))
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(res.status).toBe(410);
  });
});

// Plan chat is no longer an event sub-resource — it lives in a conversation
// thread. The cancelled-plan 410 for chat is covered by
// conversations.eventThread.test.ts.

// ── Un-cancellation (host only) still succeeds ────────────────────────────────

describe("A3 — PATCH /api/events/:id with cancelled:false on a cancelled event", () => {
  it("returns 200 when the host un-cancels the event", async () => {
    mockUpdateRows.value = [{ ...cancelledEvent, cancelled: false }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: false, version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(false);
  });
});

// ── Re-cancellation attempt is silently gated ─────────────────────────────────

describe("A3 — PATCH /api/events/:id with cancelled:true on an already-cancelled event", () => {
  it("returns 410 (no re-notification) when re-saving cancelled:true", async () => {
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 0 });
    expect(res.status).toBe(410);
  });
});
