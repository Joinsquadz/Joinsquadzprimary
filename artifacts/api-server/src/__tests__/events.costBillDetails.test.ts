// Bill details (base/tax/tip/fees) + cent-exact reconciliation on cost writes.
//
// Covers:
//   - a plain total-only expense still saves (legacy quick-split path)
//   - tax + flat tip + fees must add up to the stored grand total
//   - percentage tips are computed off base + tax and must reconcile
//   - shares must sum to the grand total in whole cents (uneven / penny splits)
//   - sub-cent precision and non-finite amounts are rejected
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
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const THIRD_ID = "third-user";
const COST_ID = "cost-1";
const makeApp = (userId: string) => makeTestApp(eventsRouter, { id: userId });

beforeEach(() => {
  const ev = makeBaseEvent({
    version: 2,
    cancelled: false,
    rsvps: { [RSVP_USER_ID]: "going", [THIRD_ID]: "going" },
    costs: [
      {
        id: COST_ID,
        description: "Pizza",
        amount: 30,
        paidById: HOST_ID,
        shares: [
          { userId: HOST_ID, amount: 15, paidAt: null, confirmedAt: null },
          { userId: RSVP_USER_ID, amount: 15, paidAt: null, confirmedAt: null },
        ],
      },
    ],
  });
  mockRows.value = [ev];
  mockUpdateRows.value = [{ ...ev, version: 3 }];
});

const addCost = (body: Record<string, unknown>) =>
  request(makeApp(HOST_ID))
    .post("/api/events/evt-1/costs")
    .send({ paidById: HOST_ID, version: 2, ...body });

const editCost = (body: Record<string, unknown>) =>
  request(makeApp(HOST_ID))
    .patch(`/api/events/evt-1/costs/${COST_ID}`)
    .send({ version: 2, ...body });

// ── Legacy quick split: no bill details at all ───────────────────────────────

describe("total-only expenses keep working", () => {
  it("accepts an expense with no billDetails", async () => {
    const res = await addCost({
      description: "Cab",
      amount: 24,
      shares: [
        { userId: HOST_ID, amount: 12 },
        { userId: RSVP_USER_ID, amount: 12 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("still rejects shares that do not sum to the total", async () => {
    const res = await addCost({
      description: "Cab",
      amount: 24,
      shares: [
        { userId: HOST_ID, amount: 12 },
        { userId: RSVP_USER_ID, amount: 11 },
      ],
    });
    expect(res.status).toBe(400);
  });
});

// ── Bill details must reconcile with the grand total ─────────────────────────

describe("bill details reconcile to the grand total", () => {
  it("accepts base + tax + flat tip + fees that add up exactly", async () => {
    // 80.00 + 7.20 + 15.00 + 2.50 = 104.70
    const res = await addCost({
      description: "Dinner",
      amount: 104.7,
      billDetails: { baseAmount: 80, taxAmount: 7.2, tipAmount: 15, feeAmount: 2.5 },
      shares: [
        { userId: HOST_ID, amount: 52.35 },
        { userId: RSVP_USER_ID, amount: 52.35 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("rejects a grand total that does not match its parts", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 100,
      billDetails: { baseAmount: 80, taxAmount: 7.2, tipAmount: 15, feeAmount: 2.5 },
      shares: [{ userId: HOST_ID, amount: 100 }],
    });
    expect(res.status).toBe(400);
  });

  it("computes a percentage tip from base + tax (20% of 87.20 = 17.44)", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 104.64,
      billDetails: { baseAmount: 80, taxAmount: 7.2, tipPercent: 20 },
      shares: [
        { userId: HOST_ID, amount: 52.32 },
        { userId: RSVP_USER_ID, amount: 52.32 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("rejects a percentage tip total that is off by a penny", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 104.65,
      billDetails: { baseAmount: 80, taxAmount: 7.2, tipPercent: 20 },
      shares: [{ userId: HOST_ID, amount: 104.65 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects sending both a flat tip and a percentage tip", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 100,
      billDetails: { baseAmount: 80, tipAmount: 20, tipPercent: 25 },
      shares: [{ userId: HOST_ID, amount: 100 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown bill detail fields", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 80,
      billDetails: { baseAmount: 80, serviceCharge: 10 },
      shares: [{ userId: HOST_ID, amount: 80 }],
    });
    expect(res.status).toBe(400);
  });
});

// ── Cent-exact splitting across uneven participant counts ────────────────────

describe("splits reconcile in whole cents", () => {
  it("accepts an uneven 3-way split of $100.00 (33.34/33.33/33.33)", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 100,
      shares: [
        { userId: HOST_ID, amount: 33.34 },
        { userId: RSVP_USER_ID, amount: 33.33 },
        { userId: THIRD_ID, amount: 33.33 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("rejects a 3-way split that drops the leftover penny", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 100,
      shares: [
        { userId: HOST_ID, amount: 33.33 },
        { userId: RSVP_USER_ID, amount: 33.33 },
        { userId: THIRD_ID, amount: 33.33 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("accepts a manual split with an unequal but exact distribution", async () => {
    const res = await addCost({
      description: "Bar tab",
      amount: 47.11,
      shares: [
        { userId: HOST_ID, amount: 20.01 },
        { userId: RSVP_USER_ID, amount: 27.1 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("rejects float drift that legacy tolerance would have allowed", async () => {
    // Off by 0.009 — under the old 0.01 tolerance, but not cent-exact.
    const res = await addCost({
      description: "Dinner",
      amount: 10,
      shares: [
        { userId: HOST_ID, amount: 5 },
        { userId: RSVP_USER_ID, amount: 4.991 },
      ],
    });
    expect(res.status).toBe(400);
  });
});

// ── Precision and finiteness ─────────────────────────────────────────────────

describe("invalid money values are rejected", () => {
  it("rejects a sub-cent total", async () => {
    const res = await addCost({
      description: "Coffee",
      amount: 10.005,
      shares: [{ userId: HOST_ID, amount: 10.005 }],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a sub-cent share", async () => {
    const res = await addCost({
      description: "Coffee",
      amount: 10,
      shares: [
        { userId: HOST_ID, amount: 5.001 },
        { userId: RSVP_USER_ID, amount: 4.999 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-finite amount", async () => {
    const res = await request(makeApp(HOST_ID))
      .post("/api/events/evt-1/costs")
      .set("Content-Type", "application/json")
      .send('{"description":"Bad","amount":1e999,"paidById":"host-user-id","version":2,"shares":[]}');
    expect(res.status).toBe(400);
  });

  it("rejects a negative share", async () => {
    const res = await addCost({
      description: "Dinner",
      amount: 10,
      shares: [
        { userId: HOST_ID, amount: 15 },
        { userId: RSVP_USER_ID, amount: -5 },
      ],
    });
    expect(res.status).toBe(400);
  });
});

// ── Edits enforce the same rules and retain the breakdown ────────────────────

describe("PATCH applies the same reconciliation rules", () => {
  it("accepts an edit whose bill details reconcile", async () => {
    const res = await editCost({
      description: "Dinner",
      amount: 46.2,
      billDetails: { baseAmount: 40, taxAmount: 3.2, tipAmount: 3 },
      shares: [
        { userId: HOST_ID, amount: 23.1 },
        { userId: RSVP_USER_ID, amount: 23.1 },
      ],
    });
    expect(res.status).toBe(200);
  });

  it("rejects an edit whose bill details do not reconcile", async () => {
    const res = await editCost({
      description: "Dinner",
      amount: 50,
      billDetails: { baseAmount: 40, taxAmount: 3.2, tipAmount: 3 },
      shares: [
        { userId: HOST_ID, amount: 25 },
        { userId: RSVP_USER_ID, amount: 25 },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("keeps the version guard on edits carrying bill details", async () => {
    mockUpdateRows.value = [];
    const res = await editCost({
      description: "Dinner",
      amount: 46.2,
      billDetails: { baseAmount: 40, taxAmount: 3.2, tipAmount: 3 },
      shares: [{ userId: HOST_ID, amount: 46.2 }],
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});
