import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getAvailabilityPoll: vi.fn(),
  findAvailabilityPoll: vi.fn(),
  createAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  upsertAvailabilityResponse: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../lib/logger");

// `vi.mock` is hoisted above this import, so the static import below still
// resolves against the mocked modules. Importing the router here at collection
// time — instead of via `await import(...)` inside `makeApp` — keeps the
// one-time, heavy transform of the router dependency graph (real drizzle schema)
// out of the timed test/hook window, which otherwise flakes under parallel
// CPU/transform contention.
import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const MEMBER_ID = "member-user-id";
const STRANGER_ID = "stranger-user-id";

const basePoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  createdBy: MEMBER_ID,
  title: "Find the Best Time",
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  slots: ["6PM", "7PM", "8PM", "9PM", "10PM"],
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/availability/polls/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/availability/polls/poll-1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the poll does not exist", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(null);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls/poll-1");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller lacks access", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/availability/polls/poll-1");
    expect(res.status).toBe(403);
  });

  it("returns the aggregated heatmap, my cells, and the best pick", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_ID, cells: ["Sat-8PM", "Sat-9PM"] },
      { userId: "u2", cells: ["Sat-8PM"] },
      { userId: "u3", cells: ["Sat-8PM", "Fri-7PM"] },
    ]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls/poll-1");
    expect(res.status).toBe(200);
    expect(res.body.respondentCount).toBe(3);
    expect(res.body.myCells).toEqual(["Sat-8PM", "Sat-9PM"]);
    // Sat-8PM has 3 votes — the clear winner.
    expect(res.body.best).toEqual({ cell: "Sat-8PM", count: 3, total: 3 });
    const satEight = res.body.heatmap.find((c: { cell: string }) => c.cell === "Sat-8PM");
    expect(satEight.count).toBe(3);
  });

  it("returns best=null when there are no responses", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls/poll-1");
    expect(res.status).toBe(200);
    expect(res.body.best).toBeNull();
    expect(res.body.respondentCount).toBe(0);
  });
});

describe("GET /api/availability/polls/:id — ISO-date cells", () => {
  const datedPoll = {
    ...basePoll,
    id: "poll-dated",
    title: "Pick a Weekend",
    days: ["2026-06-13", "2026-06-14", "2026-06-15"],
    slots: ["6PM", "7PM", "8PM", "9PM"],
  };

  it("aggregates dated cells and lands the best pick on the correct calendar date", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(datedPoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_ID, cells: ["2026-06-14-8PM", "2026-06-13-7PM"] },
      { userId: "u2", cells: ["2026-06-14-8PM"] },
      { userId: "u3", cells: ["2026-06-14-8PM", "2026-06-15-9PM"] },
    ]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls/poll-dated");
    expect(res.status).toBe(200);
    expect(res.body.respondentCount).toBe(3);
    // The date with dashes round-trips: best pick is the Sunday 8PM slot.
    expect(res.body.best).toEqual({ cell: "2026-06-14-8PM", count: 3, total: 3 });
    const winner = res.body.heatmap.find(
      (c: { cell: string }) => c.cell === "2026-06-14-8PM",
    );
    expect(winner.count).toBe(3);
    const single = res.body.heatmap.find(
      (c: { cell: string }) => c.cell === "2026-06-13-7PM",
    );
    expect(single.count).toBe(1);
  });

  it("breaks ties on dated cells by earliest day then earliest slot", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(datedPoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    // Two cells tie at 2 votes. The later-day/later-slot cell is inserted into
    // the heatmap first, so a correct tie-break must REPLACE it with the
    // earlier calendar slot ("2026-06-13-6PM") rather than keeping insertion
    // order.
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_ID, cells: ["2026-06-15-9PM", "2026-06-13-6PM"] },
      { userId: "u2", cells: ["2026-06-15-9PM", "2026-06-13-6PM"] },
    ]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls/poll-dated");
    expect(res.status).toBe(200);
    expect(res.body.best).toEqual({ cell: "2026-06-13-6PM", count: 2, total: 2 });
  });
});

describe("PUT /api/availability/polls/:id/me", () => {
  it("returns 403 when the caller lacks access", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Sat-8PM"] });
    expect(res.status).toBe(403);
  });

  it("filters out cells that are not part of the poll grid before saving", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.upsertAvailabilityResponse.mockResolvedValue({});
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_ID, cells: ["Sat-8PM"] },
    ]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Sat-8PM", "Mon-3AM", "bogus"] });
    expect(res.status).toBe(200);
    expect(storageMock.upsertAvailabilityResponse).toHaveBeenCalledWith(
      "poll-1",
      MEMBER_ID,
      ["Sat-8PM"],
      "manual",
    );
  });
});

describe("POST /api/availability/polls", () => {
  it("returns 400 when neither squadId nor eventId is provided", async () => {
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).post("/api/availability/polls").send({});
    expect(res.status).toBe(400);
  });

  it("returns 403 when not a squad member", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1" });
    expect(res.status).toBe(403);
  });

  it("reuses an existing poll for the same scope (200)", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.findAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1" });
    expect(res.status).toBe(200);
    expect(storageMock.createAvailabilityPoll).not.toHaveBeenCalled();
    expect(res.body.poll.id).toBe("poll-1");
  });

  it("creates a new poll when none exists (201)", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.findAvailabilityPoll.mockResolvedValue(null);
    storageMock.createAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1" });
    expect(res.status).toBe(201);
    expect(storageMock.createAvailabilityPoll).toHaveBeenCalled();
  });
});
