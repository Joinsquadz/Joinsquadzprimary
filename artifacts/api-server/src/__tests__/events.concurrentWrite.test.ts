import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Shared mutable containers for DB mock return values.
// Tests set these in `beforeEach` / inside each `it` block to control what the
// DB "returns", letting us simulate a version-match (success) or a version-miss
// (conflict) without touching the real database.
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
    version: "version",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  usersTable: {},
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
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
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const baseEvent = makeBaseEvent({
  version: 0,
  polls: [
    {
      id: "poll-1",
      question: "Where to eat?",
      options: [{ id: "opt-1", label: "Pizza", voterIds: [] }],
    },
  ],
});

// Valid cost body — payer and share both reference HOST_ID, who is in the
// event's allowed-participant set (hostId).
const costBody = {
  description: "Pizza",
  amount: 30,
  paidById: HOST_ID,
  shares: [{ userId: HOST_ID, amount: 30 }],
  version: 0,
};

beforeEach(() => {
  mockRows.value = [baseEvent];
  mockUpdateRows.value = [baseEvent];
});

// ─── POST /events/:id/rsvp ────────────────────────────────────────────────────

describe("POST /api/events/:id/rsvp — atomic per-user merge (no version conflict)", () => {
  // RSVP no longer uses the whole-row version gate: each user writes only their
  // OWN key in the rsvps JSON map (server-side `||` merge), so concurrent RSVPs
  // from different users are disjoint and must never report a 409 "conflict".
  it("returns 200 when a version is supplied (the version is ignored, not gated)", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going", version: 0 });
    expect(res.status).toBe(200);
  });

  it("a stale version still succeeds — RSVPs merge per-user and never 409", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going", version: 0 });
    expect(res.status).toBe(200);
    expect(res.body.conflict).toBeUndefined();
  });

  it("two concurrent RSVPs from different users both succeed (no lost-update 409)", async () => {
    const appA = makeApp({ id: HOST_ID });
    const appB = makeApp({ id: RSVP_USER_ID });
    const [a, b] = await Promise.all([
      request(appA).post("/api/events/evt-1/rsvp").send({ status: "going", version: 0 }),
      request(appB).post("/api/events/evt-1/rsvp").send({ status: "maybe", version: 0 }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.conflict).toBeUndefined();
    expect(b.body.conflict).toBeUndefined();
  });

  it("returns 404 only when the event row no longer exists", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going", version: 0 });
    expect(res.status).toBe(404);
  });
});

// ─── POST /events/:id/costs ───────────────────────────────────────────────────

describe("POST /api/events/:id/costs — version-based conflict protection", () => {
  it("returns 200 when the client version matches the stored version", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/costs")
      .send(costBody);
    expect(res.status).toBe(200);
  });

  it("returns 409 when the stored version has advanced past the client version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/costs")
      .send(costBody);
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  it("second of two concurrent requests with the same version gets 409", async () => {
    const app = makeApp({ id: HOST_ID });

    mockUpdateRows.value = [baseEvent];
    const first = await request(app)
      .post("/api/events/evt-1/costs")
      .send(costBody);
    expect(first.status).toBe(200);

    mockUpdateRows.value = [];
    const second = await request(app)
      .post("/api/events/evt-1/costs")
      .send(costBody);
    expect(second.status).toBe(409);
    expect(second.body.conflict).toBe(true);
  });
});

// ─── POST /events/:id/polls/:pollId/vote ─────────────────────────────────────

describe("POST /api/events/:id/polls/:pollId/vote — version-based conflict protection", () => {
  it("returns 200 when the client version matches the stored version", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 409 when the stored version has advanced past the client version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  it("second of two concurrent requests with the same version gets 409", async () => {
    const app = makeApp({ id: HOST_ID });

    // Simulate two users tapping the same poll option at the same time.
    mockUpdateRows.value = [baseEvent];
    const first = await request(app)
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(first.status).toBe(200);

    // The first write bumped the version; the second sees a stale version.
    mockUpdateRows.value = [];
    const second = await request(app)
      .post("/api/events/evt-1/polls/poll-1/vote")
      .send({ optionId: "opt-1", version: 0 });
    expect(second.status).toBe(409);
    expect(second.body.conflict).toBe(true);
  });
});

// ─── POST /events/:id/messages ────────────────────────────────────────────────

describe("POST /api/events/:id/messages — version-based conflict protection", () => {
  it("returns 200 when the client version matches the stored version", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/messages")
      .send({ text: "Can't wait!", version: 0 });
    expect(res.status).toBe(200);
  });

  it("returns 409 when the stored version has advanced past the client version", async () => {
    mockUpdateRows.value = [];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/messages")
      .send({ text: "Can't wait!", version: 0 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
  });

  it("second of two concurrent requests with the same version gets 409", async () => {
    const app = makeApp({ id: HOST_ID });

    mockUpdateRows.value = [baseEvent];
    const first = await request(app)
      .post("/api/events/evt-1/messages")
      .send({ text: "First!", version: 0 });
    expect(first.status).toBe(200);

    mockUpdateRows.value = [];
    const second = await request(app)
      .post("/api/events/evt-1/messages")
      .send({ text: "Also first!", version: 0 });
    expect(second.status).toBe(409);
    expect(second.body.conflict).toBe(true);
  });
});

// ─── Version field is optional — omitting it never triggers a conflict ────────

describe("version field is optional — omitting it bypasses conflict protection", () => {
  it("POST /api/events/:id/rsvp without version always succeeds (no WHERE version clause)", async () => {
    mockUpdateRows.value = [baseEvent];
    const app = makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(200);
  });

  it("POST /api/events/:id/messages without version always succeeds", async () => {
    mockUpdateRows.value = [baseEvent];
    const app = makeApp({ id: RSVP_USER_ID });
    const res = await request(app)
      .post("/api/events/evt-1/messages")
      .send({ text: "Hey!" });
    expect(res.status).toBe(200);
  });
});
