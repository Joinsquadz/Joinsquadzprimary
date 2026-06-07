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
  },
}));

vi.mock("../lib/logger");

// `vi.mock` is hoisted above this import, so the static import below still
// resolves against the mocked modules. Importing the router here at collection
// time — instead of via `await import(...)` inside `makeApp` — keeps the
// one-time, heavy transform of the router dependency graph (real drizzle schema)
// out of the timed test/hook window, which otherwise flakes under parallel
// CPU/transform contention.
import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const HOST_ID = "host-user-id";
const STRANGER_ID = "stranger-user-id";
const RSVP_USER_ID = "rsvp-user-id";

const baseEvent = {
  id: "evt-1",
  title: "Test Event",
  emoji: "🎉",
  date: "2026-07-01",
  location: "Somewhere",
  squadId: "",
  squadName: "Personal",
  hostId: HOST_ID,
  description: "",
  inviteCode: "SQ-ABCD",
  cancelled: false,
  budget: null,
  rsvps: { [RSVP_USER_ID]: "going" },
  tasks: [],
  costs: [],
  polls: [],
  messages: [],
  createdAt: new Date().toISOString(),
};

describe("GET /api/events/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("evt-1");
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("evt-1");
  });

  it("returns 404 when event does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/events/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/events/:id", () => {
  beforeEach(() => {
    mockUpdateRows.value = [{ ...baseEvent, title: "Updated" }];
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated" });
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated" });
    expect(res.status).toBe(200);
  });

  it("returns 404 when event does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/events/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).delete("/api/events/evt-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).delete("/api/events/evt-1");
    expect(res.status).toBe(403);
  });

  it("returns 204 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/evt-1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when event does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).delete("/api/events/nonexistent");
    expect(res.status).toBe(404);
  });
});
