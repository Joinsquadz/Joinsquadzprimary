import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * A converted poll is TERMINAL.
 *
 * The poll row survives conversion so an old share link still resolves, but the
 * moment it becomes a plan it must stop accepting writes. Before this, a member
 * sitting on a board that had already been locked in could keep saving times
 * into a poll nobody would ever read again — their answers silently went
 * nowhere and the host's plan looked like it had drifted.
 *
 * Reads get a terminal payload pointing at the plan; every write gets a 409
 * (not a 403 — the client has to be able to tell "this is finished, go look at
 * the plan" apart from "you aren't allowed in here").
 */
const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  upsertAvailabilityResponse: vi.fn(),
  updateAvailabilityPoll: vi.fn(),
  createNudge: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  getUsers: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  getRecentNudgesFromUser: vi.fn(),
  getLatestNudgeForUser: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: () => Promise.resolve([]) }));
vi.mock("../lib/availabilityEvents", () => ({
  emitPollUpdate: vi.fn(),
  onPollUpdate: vi.fn(),
}));

import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const CREATOR = "creator-id";
const MEMBER = "member-id";

const convertedPoll = {
  id: "poll-done",
  squadId: "squad-1",
  eventId: null,
  participantIds: null,
  createdBy: CREATOR,
  title: "Dinner",
  days: ["2026-06-20"],
  slots: ["7PM"],
  createdAt: new Date("2026-06-18T00:00:00Z"),
  updatedAt: null,
  updatedBy: null,
  convertedEventId: "event-77",
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAvailabilityPoll.mockResolvedValue(convertedPoll);
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.getAvailabilityResponses.mockResolvedValue([]);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [CREATOR, MEMBER] });
  // The terminal payload resolves the plan's type so the client can route a
  // converted TRIP to /trip/:id instead of dead-ending on /event/:id.
  storageMock.getEvent.mockResolvedValue({ id: "event-77", type: "event", hostId: CREATOR });
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getRecentNudgesFromUser.mockResolvedValue(new Map());
  storageMock.getLatestNudgeForUser.mockResolvedValue(null);
});

describe("GET /api/availability/polls/:id — converted poll", () => {
  it("returns the terminal payload with the plan id instead of an editable grid", async () => {
    const app = await makeApp({ id: MEMBER });
    const res = await request(app).get("/api/availability/polls/poll-done");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ converted: true, convertedEventId: "event-77" });
    // No grid: the heatmap/myCells the client would render a board from must be
    // absent, so a stale link can't present answerable cells.
    expect(res.body.heatmap).toBeUndefined();
    expect(res.body.myCells).toBeUndefined();
    expect(storageMock.getAvailabilityResponses).not.toHaveBeenCalled();
  });

  it("reports the plan type so a converted trip routes to /trip, not /event", async () => {
    storageMock.getEvent.mockResolvedValue({ id: "event-77", type: "trip", hostId: CREATOR });
    const app = await makeApp({ id: MEMBER });
    const res = await request(app).get("/api/availability/polls/poll-done");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ convertedEventId: "event-77", convertedEventType: "trip" });
  });

  it("still returns the terminal card when the plan lookup fails", async () => {
    // Losing the type must not cost the user the "this poll is closed" state —
    // it only degrades the link target back to the event route.
    storageMock.getEvent.mockRejectedValue(new Error("db down"));
    const app = await makeApp({ id: MEMBER });
    const res = await request(app).get("/api/availability/polls/poll-done");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ converted: true, convertedEventType: null });
  });

  it("still enforces access — a converted poll is not public", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: "stranger-id" });
    const res = await request(app).get("/api/availability/polls/poll-done");
    expect(res.status).toBe(403);
  });
});

describe("converted polls reject every write", () => {
  it("rejects a member saving their availability with 409", async () => {
    const app = await makeApp({ id: MEMBER });
    const res = await request(app)
      .put("/api/availability/polls/poll-done/me")
      .send({ cells: ["2026-06-20-7PM"] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ alreadyConverted: true, convertedEventId: "event-77" });
    expect(storageMock.upsertAvailabilityResponse).not.toHaveBeenCalled();
  });

  it("rejects the host re-ranging the poll with 409", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .patch("/api/availability/polls/poll-done")
      .send({ days: ["2026-07-01", "2026-07-02"] });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ alreadyConverted: true, convertedEventId: "event-77" });
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("rejects nudging on a finished poll with 409", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-done/nudge")
      .send({ targetUserId: MEMBER });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ alreadyConverted: true });
    expect(storageMock.createNudge).not.toHaveBeenCalled();
  });
});
