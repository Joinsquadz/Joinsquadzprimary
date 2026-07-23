// C2 — closed polls: host/co-admin can close a poll (PATCH); closed polls
// reject votes server-side with 400 "This poll is closed — voting has ended."
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
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  },
  eventsTable: {
    id: "id", hostId: "host_id", rsvps: "rsvps", type: "type",
    squadId: "squad_id", eventAt: "event_at", endAt: "end_at",
    createdAt: "created_at", version: "version", invitedUserIds: "invited_user_ids",
    cancelled: "cancelled",
  },
  eventInvitesTable: {
    id: "id", eventId: "event_id", inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id", status: "status", createdAt: "created_at",
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

const CO_ADMIN_ID = "co-admin-user";
const POLL_ID = "poll-1";
const OPT_ID = "opt-1";

function makeEventWithPoll(closed: boolean) {
  return makeBaseEvent({
    version: 1,
    cancelled: false,
    coAdminIds: [CO_ADMIN_ID],
    rsvps: { [RSVP_USER_ID]: "going", [CO_ADMIN_ID]: "going" },
    polls: [
      {
        id: POLL_ID,
        question: "Best venue?",
        closed,
        options: [
          { id: OPT_ID, label: "Park", voterIds: [] },
          { id: "opt-2", label: "Beach", voterIds: [] },
        ],
      },
    ],
  });
}

const makeApp = (userId = HOST_ID) => makeTestApp(eventsRouter, { id: userId });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── C2: voting on a closed poll is rejected ───────────────────────────────────

describe("C2 — POST /api/events/:id/polls/:pollId/vote on a closed poll", () => {
  it("returns 400 when the poll is closed (host)", async () => {
    mockRows.value = [makeEventWithPoll(true)];
    const res = await request(makeApp())
      .post(`/api/events/evt-1/polls/${POLL_ID}/vote`)
      .send({ optionId: OPT_ID, version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/poll is closed/i);
  });

  it("returns 400 when an RSVP'd member tries to vote on a closed poll", async () => {
    mockRows.value = [makeEventWithPoll(true)];
    const res = await request(makeApp(RSVP_USER_ID))
      .post(`/api/events/evt-1/polls/${POLL_ID}/vote`)
      .send({ optionId: OPT_ID, version: 1 });
    expect(res.status).toBe(400);
  });

  it("returns 200 when the poll is open", async () => {
    const ev = makeEventWithPoll(false);
    mockRows.value = [ev];
    mockUpdateRows.value = [
      {
        ...ev,
        polls: [
          {
            id: POLL_ID,
            question: "Best venue?",
            closed: false,
            options: [
              { id: OPT_ID, label: "Park", voterIds: [HOST_ID] },
              { id: "opt-2", label: "Beach", voterIds: [] },
            ],
          },
        ],
        version: 2,
      },
    ];
    const res = await request(makeApp())
      .post(`/api/events/evt-1/polls/${POLL_ID}/vote`)
      .send({ optionId: OPT_ID, version: 1 });
    expect(res.status).toBe(200);
  });
});

// ── C2: host/co-admin can close and reopen a poll ────────────────────────────

describe("C2 — PATCH /api/events/:id/polls/:pollId close/reopen", () => {
  it("host can close an open poll (200)", async () => {
    const ev = makeEventWithPoll(false);
    mockRows.value = [ev];
    mockUpdateRows.value = [
      { ...ev, polls: [{ ...ev.polls[0], closed: true }], version: 2 },
    ];
    const res = await request(makeApp())
      .patch(`/api/events/evt-1/polls/${POLL_ID}`)
      .send({ closed: true, version: 1 });
    expect(res.status).toBe(200);
  });

  it("host can reopen a closed poll (200)", async () => {
    const ev = makeEventWithPoll(true);
    mockRows.value = [ev];
    mockUpdateRows.value = [
      { ...ev, polls: [{ ...ev.polls[0], closed: false }], version: 2 },
    ];
    const res = await request(makeApp())
      .patch(`/api/events/evt-1/polls/${POLL_ID}`)
      .send({ closed: false, version: 1 });
    expect(res.status).toBe(200);
  });

  it("co-admin can close an open poll (200)", async () => {
    const ev = makeEventWithPoll(false);
    mockRows.value = [ev];
    mockUpdateRows.value = [
      { ...ev, polls: [{ ...ev.polls[0], closed: true }], version: 2 },
    ];
    const res = await request(makeApp(CO_ADMIN_ID))
      .patch(`/api/events/evt-1/polls/${POLL_ID}`)
      .send({ closed: true, version: 1 });
    expect(res.status).toBe(200);
  });

  it("regular RSVP'd member cannot close a poll (403)", async () => {
    const ev = makeEventWithPoll(false);
    mockRows.value = [ev];
    const res = await request(makeApp(RSVP_USER_ID))
      .patch(`/api/events/evt-1/polls/${POLL_ID}`)
      .send({ closed: true, version: 1 });
    expect(res.status).toBe(403);
  });
});
