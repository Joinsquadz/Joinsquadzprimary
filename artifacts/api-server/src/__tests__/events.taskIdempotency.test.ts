import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Capture the tasks array passed to db.update().set() so tests can assert
// the server is writing an explicit boolean, not performing a toggle.
const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const lastSetArgs = vi.hoisted(
  () => ({ value: null as { tasks?: Array<{ id: string; done: boolean }> } | null }),
);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
    update: () => ({
      set: (args: { tasks?: Array<{ id: string; done: boolean }> }) => {
        lastSetArgs.value = args;
        return {
          where: () => ({
            returning: () => Promise.resolve(mockUpdateRows.value),
          }),
        };
      },
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve(mockUpdateRows.value) }),
    }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    version: "version",
    rsvps: "rsvps",
    createdAt: "created_at",
    inviteCode: "invite_code",
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

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = (userId = HOST_ID) => makeTestApp(eventsRouter, { id: userId });

const baseEvent = makeBaseEvent({
  tasks: [{ id: "t1", title: "Buy drinks", assigneeId: null, done: false }],
});

const doneEvent = makeBaseEvent({
  tasks: [{ id: "t1", title: "Buy drinks", assigneeId: null, done: true }],
});

// Read the captured task from inside its own scope so the in-test
// `lastSetArgs.value = null` resets don't leave the property control-flow
// narrowed to `null` when it's read again after an awaited request.
const writtenTask = (id: string) => lastSetArgs.value?.tasks?.find((t) => t.id === id);

beforeEach(() => {
  lastSetArgs.value = null;
  mockRows.value = [baseEvent];
  mockUpdateRows.value = [doneEvent];
});

describe("PATCH /api/events/:id/tasks/:taskId — idempotency", () => {
  it("accepts an explicit done: true and writes true to the DB (not a toggle)", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: true, version: 0 });

    expect(res.status).toBe(200);
    const written = writtenTask("t1");
    expect(written?.done).toBe(true);
  });

  it("is idempotent: two identical PATCHes with done: true both succeed and both write done: true", async () => {
    const app = await makeApp();

    const first = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: true, version: 0 });

    expect(first.status).toBe(200);
    const firstWritten = writtenTask("t1");
    expect(firstWritten?.done).toBe(true);

    // Simulate the event already having done: true when the duplicate arrives.
    mockRows.value = [doneEvent];
    lastSetArgs.value = null;

    const second = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: true, version: 0 });

    expect(second.status).toBe(200);
    const secondWritten = writtenTask("t1");
    // The server wrote the explicit value from the request body, not a toggle of
    // the current DB state — so done remains true after the duplicate request.
    expect(secondWritten?.done).toBe(true);
  });

  it("is idempotent: two identical PATCHes with done: false both write done: false", async () => {
    const undoneEvent = makeBaseEvent({
      tasks: [{ id: "t1", title: "Buy drinks", assigneeId: null, done: false }],
    });
    mockUpdateRows.value = [undoneEvent];

    const app = await makeApp();

    const first = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: false, version: 0 });
    expect(first.status).toBe(200);
    expect(writtenTask("t1")?.done).toBe(false);

    lastSetArgs.value = null;

    const second = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: false, version: 0 });
    expect(second.status).toBe(200);
    expect(writtenTask("t1")?.done).toBe(false);
  });

  it("rejects a non-boolean done value with 400", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: "true", version: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects a numeric done value with 400", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: 1, version: 0 });
    expect(res.status).toBe(400);
  });

  it("allows RSVP'd member (not just host) to submit idempotent updates", async () => {
    const app = await makeApp(RSVP_USER_ID);

    const first = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: true, version: 0 });
    expect(first.status).toBe(200);

    mockRows.value = [doneEvent];
    lastSetArgs.value = null;

    const second = await request(app)
      .patch("/api/events/evt-1/tasks/t1")
      .send({ done: true, version: 0 });
    expect(second.status).toBe(200);
    expect(writtenTask("t1")?.done).toBe(true);
  });
});
