import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Shared mutable containers for DB mock return values. `mockRows` is what a
// `SELECT` returns (the stored event the route reads first); `mockUpdateRows`
// is what the version-checked `UPDATE ... RETURNING` returns ([] simulates a
// stale-version miss → 409). Tests tweak these per case.
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
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
      }),
    }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    rsvps: "rsvps",
    type: "type",
    squadId: "squad_id",
    version: "version",
    itinerary: "itinerary",
    packing: "packing",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  usersTable: {},
}));

// Trip authz reads live squad membership via storage.getSquad — a member is
// allowed without an RSVP, a non-member is denied. Each test sets the squad's
// memberIds to control who counts as a current member.
const mockSquad = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn(() => Promise.resolve(mockSquad.value)),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

// Static import below vi.mock — keeps the heavy dependency-graph transform out
// of the timed test window (see .agents/memory/api-server-test-cold-import.md).
import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { HOST_ID, MEMBER_ID, STRANGER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

// A trip is a normal event with `type: "trip"`, a backing squad, and the two
// trip-only JSON columns (itinerary + packing). Authz is live-squad-membership,
// so HOST_ID (host) and MEMBER_ID (squad member) are allowed; STRANGER_ID is not.
const makeTrip = (overrides: Record<string, unknown> = {}) =>
  makeBaseEvent({
    type: "trip",
    squadId: "squad-1",
    version: 0,
    itinerary: [
      {
        id: "s1",
        day: "2026-07-01",
        time: "",
        endTime: "",
        title: "Brunch",
        placeName: "",
        address: "",
        note: "",
        category: "food",
        status: "proposed",
        cost: null,
        paidById: null,
        assigneeId: null,
        createdBy: HOST_ID,
        votes: [],
        sortOrder: 0,
      },
    ],
    packing: [
      { id: "p1", label: "Sunscreen", done: false, assigneeId: null, createdBy: HOST_ID },
    ],
    ...overrides,
  });

const TRIP_SQUAD = { id: "squad-1", memberIds: [HOST_ID, MEMBER_ID] };

beforeEach(() => {
  const trip = makeTrip();
  mockRows.value = [trip];
  mockUpdateRows.value = [trip];
  mockSquad.value = TRIP_SQUAD;
});

// ─── Add itinerary stop ───────────────────────────────────────────────────────

describe("POST /api/events/:id/itinerary — add a stop", () => {
  const body = { day: "2026-07-02", title: "Hike", version: 0 };

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 200 for the host", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 for a current squad member (no RSVP required)", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 400 when the event is not a trip (ensureTripEvent)", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/itinerary")
      .send({ day: "2026-07-02", title: "Hike" });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary").send(body);
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  // ── Cost-split spoofing: paidById/assigneeId must be a trip participant ──
  // The squad members are HOST_ID + MEMBER_ID; STRANGER_ID is not on the trip.

  it("accepts paidById/assigneeId that reference a current trip participant", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/itinerary")
      .send({ ...body, cost: 40, paidById: MEMBER_ID, assigneeId: HOST_ID });
    expect(res.status).toBe(200);
  });

  it("rejects a paidById that isn't a trip participant", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/itinerary")
      .send({ ...body, cost: 40, paidById: STRANGER_ID });
    expect(res.status).toBe(400);
  });

  it("rejects an assigneeId that isn't a trip participant", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/itinerary")
      .send({ ...body, cost: 40, assigneeId: STRANGER_ID });
    expect(res.status).toBe(400);
  });

  it("allows clearing the money fields with null", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/itinerary")
      .send({ ...body, cost: null, paidById: null, assigneeId: null });
    expect(res.status).toBe(200);
  });
});

// ─── Edit itinerary stop ──────────────────────────────────────────────────────

describe("PATCH /api/events/:id/itinerary/:stopId — edit a stop", () => {
  const body = { title: "Late brunch", version: 0 };

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).patch("/api/events/evt-1/itinerary/s1").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 200 for a current squad member", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).patch("/api/events/evt-1/itinerary/s1").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).patch("/api/events/evt-1/itinerary/s1").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 404 when the stop does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/itinerary/nope").send(body);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/itinerary/s1").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1/itinerary/s1")
      .send({ title: "Late brunch" });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/itinerary/s1").send(body);
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  // ── Cost-split spoofing on edit: paidById/assigneeId must be a participant ──

  it("accepts editing money fields to a current trip participant", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/events/evt-1/itinerary/s1")
      .send({ cost: 25, paidById: HOST_ID, assigneeId: MEMBER_ID, version: 0 });
    expect(res.status).toBe(200);
  });

  it("rejects editing paidById to a non-participant", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/events/evt-1/itinerary/s1")
      .send({ paidById: STRANGER_ID, version: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects editing assigneeId to a non-participant", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/events/evt-1/itinerary/s1")
      .send({ assigneeId: STRANGER_ID, version: 0 });
    expect(res.status).toBe(400);
  });

  it("allows clearing money fields to null on edit", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/events/evt-1/itinerary/s1")
      .send({ cost: null, paidById: null, assigneeId: null, version: 0 });
    expect(res.status).toBe(200);
  });
});

// ─── Delete itinerary stop ────────────────────────────────────────────────────

describe("DELETE /api/events/:id/itinerary/:stopId — remove a stop", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(401);
  });

  it("returns 200 for the host (host may remove any stop)", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a member who did not author the stop", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the stop does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/nope").send({ version: 0 });
    expect(res.status).toBe(404);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/itinerary/s1").send({ version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Vote on itinerary stop ───────────────────────────────────────────────────

describe("POST /api/events/:id/itinerary/:stopId/vote — toggle an upvote", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({ version: 0 });
    expect(res.status).toBe(401);
  });

  it("returns 200 for a current squad member", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({ version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the stop does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/nope/vote").send({ version: 0 });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({ version: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({});
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/vote").send({ version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Confirm itinerary stop ───────────────────────────────────────────────────

describe("POST /api/events/:id/itinerary/:stopId/confirm — confirm a proposed stop", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({ version: 0 });
    expect(res.status).toBe(401);
  });

  it("returns 200 for a current squad member", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({ version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the stop does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/nope/confirm").send({ version: 0 });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({ version: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({});
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/itinerary/s1/confirm").send({ version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Add packing item ─────────────────────────────────────────────────────────

describe("POST /api/events/:id/packing — add an item", () => {
  const body = { label: "Passport", version: 0 };

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/events/evt-1/packing").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 200 for a current squad member", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/events/evt-1/packing").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/packing").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/packing").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/packing").send({ label: "Passport" });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/packing").send(body);
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Toggle packing item ──────────────────────────────────────────────────────

describe("PATCH /api/events/:id/packing/:itemId — toggle done", () => {
  const body = { done: true, version: 0 };

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 200 for a current squad member", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 404 when the item does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/nope").send(body);
    expect(res.status).toBe(404);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send(body);
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send({ done: true });
    expect(res.status).toBe(400);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/packing/p1").send(body);
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Remove packing item ──────────────────────────────────────────────────────

describe("DELETE /api/events/:id/packing/:itemId — remove an item", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(401);
  });

  it("returns 200 for the host (host may remove any item)", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 403 for a member who did not author the item", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-member", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(403);
  });

  it("returns 400 when version is missing", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when the event is not a trip", async () => {
    mockRows.value = [makeBaseEvent({ type: "hangout", version: 0 })];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the item does not exist", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/nope").send({ version: 0 });
    expect(res.status).toBe(404);
  });

  it("returns 409 on a stale version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1/packing/p1").send({ version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });
});

// ─── Read a PAST trip's itinerary + packing ───────────────────────────────────
// A past trip is filtered out of the time-scoped GET /events list, so the hub
// opens it via the single-event GET /events/:id path (no time filter). This
// must still return the full event including its itinerary and packing.

describe("GET /api/events/:id — open a PAST trip and read itinerary/packing", () => {
  const pastTrip = () =>
    makeTrip({ date: "2020-01-01", eventAt: new Date("2020-01-01T10:00:00Z") });

  it("returns 200 with itinerary + packing for a current squad member", async () => {
    mockRows.value = [pastTrip()];
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.itinerary).toHaveLength(1);
    expect(res.body.itinerary[0].id).toBe("s1");
    expect(res.body.packing).toHaveLength(1);
    expect(res.body.packing[0].id).toBe("p1");
  });

  it("returns 200 for the host", async () => {
    mockRows.value = [pastTrip()];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member", async () => {
    mockRows.value = [pastTrip()];
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(403);
  });
});
