import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
// Captures the WHERE predicate passed to db.update().set().where() so tests can
// assert that the version clause is (or is not) included in the update predicate.
const capturedUpdateWhere = vi.hoisted(() => ({ arg: null as unknown }));

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
        where: (pred: unknown) => {
          capturedUpdateWhere.arg = pred;
          return { returning: () => Promise.resolve(mockUpdateRows.value) };
        },
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
    version: "version",
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
import {
  HOST_ID,
  STRANGER_ID,
  RSVP_USER_ID,
  makeBaseEvent,
} from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const baseEvent = makeBaseEvent();

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

// Recursively walks a Drizzle SQL object (which stores values in nested
// `queryChunks` / `value` properties) looking for a specific primitive value.
// Cycle-safe via a WeakSet so circular refs in internal Drizzle structures
// don't cause infinite loops.
function deepContains(obj: unknown, target: unknown, seen = new WeakSet<object>()): boolean {
  if (obj === target) return true;
  if (obj === null || typeof obj !== "object") return false;
  if (seen.has(obj)) return false;
  seen.add(obj);
  return Object.values(obj as Record<string, unknown>).some((v) =>
    deepContains(v, target, seen),
  );
}

describe("PATCH /api/events/:id — concurrent-edit version guard", () => {
  const CLIENT_VERSION = 3;
  const STALE_VERSION = 1;
  const eventAtV3 = makeBaseEvent({ version: CLIENT_VERSION });
  const updatedEvent = makeBaseEvent({ title: "Updated", version: CLIENT_VERSION + 1 });

  beforeEach(() => {
    capturedUpdateWhere.arg = null;
  });

  it("returns 200, version incremented, and WHERE includes the version clause", async () => {
    mockRows.value = [eventAtV3];
    mockUpdateRows.value = [updatedEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated", version: CLIENT_VERSION });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Updated");
    // The mock response carries the incremented version (CLIENT_VERSION + 1)
    expect(res.body.version).toBe(CLIENT_VERSION + 1);
    // The WHERE predicate passed to db.update must include the client version
    // value so that a concurrent writer who already bumped the row is rejected.
    expect(deepContains(capturedUpdateWhere.arg, CLIENT_VERSION)).toBe(true);
  });

  it("returns 409 with conflict:true when the version is stale, WHERE still includes the stale version", async () => {
    mockRows.value = [eventAtV3];
    // DB returns nothing because the version clause in WHERE didn't match
    mockUpdateRows.value = [];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated", version: STALE_VERSION });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
    // Even in the 409 path the WHERE was built with the supplied stale version,
    // confirming the guard is applied and not bypassed.
    expect(deepContains(capturedUpdateWhere.arg, STALE_VERSION)).toBe(true);
  });

  it("returns 200 without a version field (backwards-compatible omission, WHERE has no numeric version)", async () => {
    mockRows.value = [eventAtV3];
    mockUpdateRows.value = [updatedEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/events/evt-1")
      .send({ title: "Updated" });
    expect(res.status).toBe(200);
    // When version is omitted the WHERE is the plain id-equality clause;
    // no version number should appear in the predicate.
    expect(deepContains(capturedUpdateWhere.arg, CLIENT_VERSION)).toBe(false);
    expect(deepContains(capturedUpdateWhere.arg, STALE_VERSION)).toBe(false);
  });
});

describe("PATCH /api/events/:id/tasks/:taskId — concurrent-edit version guard", () => {
  const TASK_CLIENT_VERSION = 5;
  const TASK_STALE_VERSION = 2;
  const taskId = "task-abc";
  const eventWithTask = makeBaseEvent({
    version: TASK_CLIENT_VERSION,
    tasks: [{ id: taskId, title: "Buy ice", done: false, assigneeId: null }],
  });
  const updatedEvent = makeBaseEvent({
    version: TASK_CLIENT_VERSION + 1,
    tasks: [{ id: taskId, title: "Buy ice", done: true, assigneeId: null }],
  });

  beforeEach(() => {
    capturedUpdateWhere.arg = null;
  });

  it("returns 200, version incremented, and WHERE includes the version clause", async () => {
    mockRows.value = [eventWithTask];
    mockUpdateRows.value = [updatedEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch(`/api/events/evt-1/tasks/${taskId}`)
      .send({ done: true, version: TASK_CLIENT_VERSION });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(TASK_CLIENT_VERSION + 1);
    expect(deepContains(capturedUpdateWhere.arg, TASK_CLIENT_VERSION)).toBe(true);
  });

  it("returns 409 with conflict:true when the version is stale, WHERE still includes the stale version", async () => {
    mockRows.value = [eventWithTask];
    // DB returns nothing because the version clause in WHERE didn't match
    mockUpdateRows.value = [];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch(`/api/events/evt-1/tasks/${taskId}`)
      .send({ done: true, version: TASK_STALE_VERSION });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
    expect(deepContains(capturedUpdateWhere.arg, TASK_STALE_VERSION)).toBe(true);
  });

  it("returns 200 without a version field (backwards-compatible omission, WHERE has no numeric version)", async () => {
    mockRows.value = [eventWithTask];
    mockUpdateRows.value = [updatedEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch(`/api/events/evt-1/tasks/${taskId}`)
      .send({ done: true });
    expect(res.status).toBe(200);
    expect(deepContains(capturedUpdateWhere.arg, TASK_CLIENT_VERSION)).toBe(false);
    expect(deepContains(capturedUpdateWhere.arg, TASK_STALE_VERSION)).toBe(false);
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
