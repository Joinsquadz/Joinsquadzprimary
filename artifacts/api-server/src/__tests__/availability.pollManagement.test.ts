import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  listAvailabilityPolls: vi.fn(),
  countResponsesForPolls: vi.fn(),
  deleteAvailabilityPoll: vi.fn(),
  markAvailabilityPollConverted: vi.fn(),
  getSquad: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/availabilityEvents", () => ({
  emitPollUpdate: vi.fn(),
  onPollUpdate: vi.fn(),
}));

import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const CREATOR_ID = "creator-user-id";
const MEMBER_ID = "member-user-id";
const STRANGER_ID = "stranger-user-id";

const squadPoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  participantIds: null,
  createdBy: CREATOR_ID,
  title: "Find the Best Time",
  days: ["2026-06-20", "2026-06-21"],
  slots: ["6PM", "7PM"],
  createdAt: new Date("2026-06-18T00:00:00Z"),
  updatedAt: null,
  convertedEventId: null,
};

const adhocPoll = {
  ...squadPoll,
  id: "poll-adhoc",
  squadId: null,
  participantIds: ["friend-a", "friend-b"],
  title: "Trip planning",
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getSquad.mockResolvedValue({ memberIds: [CREATOR_ID, MEMBER_ID] });
  storageMock.countResponsesForPolls.mockResolvedValue(new Map([["poll-1", 2]]));
});

describe("GET /api/availability/polls (list)", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/availability/polls?squadId=squad-1");
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither squadId nor scope is provided", async () => {
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls");
    expect(res.status).toBe(400);
  });

  it("returns 403 for a squad the caller is not a member of", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/availability/polls?squadId=squad-1");
    expect(res.status).toBe(403);
    expect(storageMock.listAvailabilityPolls).not.toHaveBeenCalled();
  });

  it("lists squad-scoped polls with response and member counts", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
    storageMock.listAvailabilityPolls.mockResolvedValue([squadPoll]);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls?squadId=squad-1");
    expect(res.status).toBe(200);
    expect(storageMock.listAvailabilityPolls).toHaveBeenCalledWith({ squadId: "squad-1" });
    expect(res.body.polls).toHaveLength(1);
    expect(res.body.polls[0]).toMatchObject({
      id: "poll-1",
      respondentCount: 2,
      memberCount: 2,
      mine: false,
    });
  });

  it("lists the caller's own ad-hoc polls for scope=personal", async () => {
    storageMock.listAvailabilityPolls.mockResolvedValue([adhocPoll]);
    storageMock.countResponsesForPolls.mockResolvedValue(new Map());
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app).get("/api/availability/polls?scope=personal");
    expect(res.status).toBe(200);
    expect(storageMock.listAvailabilityPolls).toHaveBeenCalledWith({ createdBy: CREATOR_ID });
    expect(res.body.polls[0]).toMatchObject({
      id: "poll-adhoc",
      memberCount: 2,
      mine: true,
      respondentCount: 0,
    });
  });
});

describe("DELETE /api/availability/polls/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).delete("/api/availability/polls/poll-1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when the poll does not exist", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(null);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app).delete("/api/availability/polls/poll-1");
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the creator", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).delete("/api/availability/polls/poll-1");
    expect(res.status).toBe(403);
    expect(storageMock.deleteAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("deletes the poll when the caller is the creator", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    storageMock.deleteAvailabilityPoll.mockResolvedValue(undefined);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app).delete("/api/availability/polls/poll-1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(storageMock.deleteAvailabilityPoll).toHaveBeenCalledWith("poll-1");
  });
});

describe("POST /api/availability/polls/:id/convert", () => {
  it("returns 403 when the caller is not the creator", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-9" });
    expect(res.status).toBe(403);
    expect(storageMock.markAvailabilityPollConverted).not.toHaveBeenCalled();
  });

  it("returns 400 when eventId is missing", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app).post("/api/availability/polls/poll-1/convert").send({});
    expect(res.status).toBe(400);
  });

  it("marks the poll converted when the creator supplies an eventId", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    storageMock.markAvailabilityPollConverted.mockResolvedValue(undefined);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-9" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, convertedEventId: "event-9" });
    expect(storageMock.markAvailabilityPollConverted).toHaveBeenCalledWith("poll-1", "event-9");
  });
});
