import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

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

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

type TestUser = { id: string; email?: string };

async function makeApp(user?: TestUser) {
  const { default: eventsRouter } = await import("../routes/events");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = function (this: Request) {
      return user != null;
    } as Request["isAuthenticated"];
    if (user) req.user = user as Express.User;
    next();
  });
  app.use("/api", eventsRouter);
  return app;
}

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
  tasks: [{ id: "t1", title: "Buy drinks", assigneeId: null, done: false }],
  costs: [],
  polls: [
    {
      id: "poll-1",
      question: "Where to eat?",
      options: [{ id: "opt-1", label: "Pizza", voterIds: [] }],
    },
  ],
  messages: [],
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  mockRows.value = [];
  mockUpdateRows.value = [baseEvent];
});

describe("POST /api/events/:id/rsvp", () => {
  const body = { userId: RSVP_USER_ID, status: "going" };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/rsvp").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/rsvp").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/rsvp").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/rsvp").send(body);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:id/tasks", () => {
  const body = { title: "Pick up supplies" };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/tasks").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/tasks").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/tasks").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/tasks").send(body);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/events/:id/tasks/:taskId", () => {
  const body = { done: true };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).patch("/api/events/evt-1/tasks/t1").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).patch("/api/events/evt-1/tasks/t1").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/events/evt-1/tasks/t1").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).patch("/api/events/evt-1/tasks/t1").send(body);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:id/costs", () => {
  const body = {
    description: "Pizza",
    amount: 30,
    paidById: HOST_ID,
    shares: [{ userId: HOST_ID, amount: 30 }],
  };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/costs").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/costs").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/costs").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/costs").send(body);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:id/polls", () => {
  const body = { question: "Where should we meet?", options: ["Park", "Cafe"] };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/polls").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/polls").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/polls").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/polls").send(body);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:id/polls/:pollId/vote", () => {
  const body = { userId: HOST_ID, optionId: "opt-1" };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/polls/poll-1/vote").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/polls/poll-1/vote").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/polls/poll-1/vote").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/polls/poll-1/vote").send(body);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/events/:id/messages", () => {
  const body = { senderId: HOST_ID, text: "Can't wait!" };

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/messages").send(body);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not host, no rsvp)", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).post("/api/events/evt-1/messages").send(body);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as the host", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).post("/api/events/evt-1/messages").send(body);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authenticated as an RSVP'd member", async () => {
    mockRows.value = [baseEvent];
    const app = await makeApp({ id: RSVP_USER_ID });
    const res = await request(app).post("/api/events/evt-1/messages").send(body);
    expect(res.status).toBe(200);
  });
});
