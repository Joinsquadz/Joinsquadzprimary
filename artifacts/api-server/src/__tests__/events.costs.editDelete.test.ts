// D1/D2/D3 — cost edit (PATCH) and delete authorization, version conflicts,
// and edit blocked when any share has a paidAt timestamp.
//
//   D1: only payer || host can edit or delete a cost; co-admin cannot
//   D2: PATCH returns 409 with {conflict:true} on a stale version; the
//       verbatim message is "Someone else just updated this — refresh to see the latest"
//   D3: PATCH returns 409 with {paymentsInProgress:true} when any share has paidAt
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
    getUser: vi.fn().mockResolvedValue({ id: "host-user-id", name: "Host" }),
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
    clearPushToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, STRANGER_ID, makeBaseEvent } from "./helpers/fixtures";

const PAYER_ID = RSVP_USER_ID; // RSVP'd member who paid
const CO_ADMIN_ID = "co-admin-user";
const COST_ID = "cost-1";

function makeEventWithCost(costOverrides: Record<string, unknown> = {}) {
  return makeBaseEvent({
    version: 2,
    cancelled: false,
    coAdminIds: [CO_ADMIN_ID],
    rsvps: { [PAYER_ID]: "going" },
    costs: [
      {
        id: COST_ID,
        description: "Pizza",
        amount: 30,
        paidById: PAYER_ID,
        shares: [
          { userId: PAYER_ID, amount: 15, paidAt: null, confirmedAt: null },
          { userId: HOST_ID, amount: 15, paidAt: null, confirmedAt: null },
        ],
        ...costOverrides,
      },
    ],
  });
}

const editBody = {
  description: "Pizza (updated)",
  amount: 40,
  shares: [
    { userId: PAYER_ID, amount: 20 },
    { userId: HOST_ID, amount: 20 },
  ],
  version: 2,
};

const makeApp = (userId: string) => makeTestApp(eventsRouter, { id: userId });

beforeEach(() => {
  const ev = makeEventWithCost();
  mockRows.value = [ev];
  mockUpdateRows.value = [{ ...ev, version: 3 }];
});

// ── D1: authorization matrix for PATCH ───────────────────────────────────────

describe("D1 — PATCH /api/events/:id/costs/:costId authorization", () => {
  it("payer can edit their own cost (200)", async () => {
    const res = await request(makeApp(PAYER_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send(editBody);
    expect(res.status).toBe(200);
  });

  it("event host can edit any cost (200)", async () => {
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send(editBody);
    expect(res.status).toBe(200);
  });

  it("co-admin cannot edit a cost they did not pay (403)", async () => {
    const res = await request(makeApp(CO_ADMIN_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ ...editBody });
    expect(res.status).toBe(403);
  });

  it("unrelated user cannot edit any cost (403)", async () => {
    const res = await request(makeApp(STRANGER_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send(editBody);
    expect(res.status).toBe(403);
  });
});

// ── D1: authorization matrix for DELETE ──────────────────────────────────────

describe("D1 — DELETE /api/events/:id/costs/:costId authorization", () => {
  it("payer can delete their own cost (200)", async () => {
    const res = await request(makeApp(PAYER_ID))
      .delete(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ version: 2 });
    expect(res.status).toBe(200);
  });

  it("event host can delete any cost (200)", async () => {
    const res = await request(makeApp(HOST_ID))
      .delete(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ version: 2 });
    expect(res.status).toBe(200);
  });

  it("co-admin cannot delete a cost they did not pay (403)", async () => {
    const res = await request(makeApp(CO_ADMIN_ID))
      .delete(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ version: 2 });
    expect(res.status).toBe(403);
  });

  it("unrelated user cannot delete any cost (403 via event-access gate)", async () => {
    // STRANGER_ID has no event access; getEventAsMemberForWrite → 403
    const res = await request(makeApp(STRANGER_ID))
      .delete(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ version: 2 });
    expect(res.status).toBe(403);
  });
});

// ── D2: version guard on PATCH ────────────────────────────────────────────────

describe("D2 — PATCH /api/events/:id/costs/:costId version conflict (409)", () => {
  it("returns 409 with conflict:true when the stored version advanced", async () => {
    // DB returns empty because the version WHERE clause didn't match.
    mockUpdateRows.value = [];
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ ...editBody, version: 1 }); // stale: stored is 2
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  it("version conflict message matches expected copy", async () => {
    mockUpdateRows.value = [];
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ ...editBody, version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/someone else just updated/i);
  });

  it("succeeds with the correct version", async () => {
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ ...editBody, version: 2 });
    expect(res.status).toBe(200);
  });
});

// ── D2: version guard on DELETE ───────────────────────────────────────────────

describe("D2 — DELETE /api/events/:id/costs/:costId version conflict (409)", () => {
  it("returns 409 with conflict:true when the stored version advanced", async () => {
    mockUpdateRows.value = [];
    const res = await request(makeApp(HOST_ID))
      .delete(`/api/events/evt-1/costs/${COST_ID}`)
      .send({ version: 0 }); // stale
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ── D3: edit blocked when any share has paidAt ────────────────────────────────

describe("D3 — PATCH /api/events/:id/costs/:costId blocked when payment exists", () => {
  it("returns 409 with paymentsInProgress:true when a share has paidAt", async () => {
    // One share has already been marked paid.
    mockRows.value = [
      makeEventWithCost({
        shares: [
          {
            userId: PAYER_ID,
            amount: 15,
            paidAt: new Date().toISOString(),
            confirmedAt: null,
          },
          { userId: HOST_ID, amount: 15, paidAt: null, confirmedAt: null },
        ],
      }),
    ];
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send(editBody);
    expect(res.status).toBe(409);
    expect(res.body.paymentsInProgress).toBe(true);
  });

  it("edit succeeds when no share has paidAt (null paidAt is not a payment)", async () => {
    const res = await request(makeApp(HOST_ID))
      .patch(`/api/events/evt-1/costs/${COST_ID}`)
      .send(editBody);
    expect(res.status).toBe(200);
  });
});
