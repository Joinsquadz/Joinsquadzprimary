import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  listAvailabilityPolls: vi.fn(),
  countResponsesForPolls: vi.fn(),
  lastResponseAtForPolls: vi.fn(),
  deleteAvailabilityPoll: vi.fn(),
  claimAvailabilityPollConversion: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
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
  // Drives the "new responses since you last looked" badge on every summary.
  storageMock.lastResponseAtForPolls.mockResolvedValue(new Map());
  // Conversion validates its target plan before claiming the poll, so the
  // event has to exist and be visible to the converter.
  storageMock.getEvent.mockResolvedValue({ id: "event-9", hostId: CREATOR_ID, squadId: "squad-1" });
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
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

  it("lists EVERY active poll for an event, not just the newest", async () => {
    // Event screens resolved their poll through /find, which returns only the
    // most recent one — so a plan with three live boards advertised one and the
    // rest were unreachable from the screen people actually open.
    const secondEventPoll = { ...squadPoll, id: "poll-2", squadId: null, eventId: "event-1" };
    const firstEventPoll = { ...squadPoll, id: "poll-1", squadId: null, eventId: "event-1" };
    storageMock.getEvent.mockResolvedValue({ id: "event-1", hostId: CREATOR_ID, squadId: "squad-1" });
    storageMock.listAvailabilityPolls.mockResolvedValue([secondEventPoll, firstEventPoll]);

    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/availability/polls?eventId=event-1");

    expect(res.status).toBe(200);
    expect(storageMock.listAvailabilityPolls).toHaveBeenCalledWith({ eventId: "event-1" });
    expect(res.body.polls.map((p: { id: string }) => p.id)).toEqual(["poll-2", "poll-1"]);
    // eventId rides along so the client can route each card back to its plan.
    expect(res.body.polls[0]).toMatchObject({ eventId: "event-1" });
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
    expect(storageMock.claimAvailabilityPollConversion).not.toHaveBeenCalled();
  });

  it("returns 400 when eventId is missing", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app).post("/api/availability/polls/poll-1/convert").send({});
    expect(res.status).toBe(400);
  });

  it("marks the poll converted when the creator supplies an eventId", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    storageMock.claimAvailabilityPollConversion.mockResolvedValue({
      claimed: true,
      convertedEventId: "event-9",
    });
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-9" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, convertedEventId: "event-9" });
    expect(storageMock.claimAvailabilityPollConversion).toHaveBeenCalledWith("poll-1", "event-9");
  });

  it("returns 409 with the winning event when the poll was already converted to a different plan", async () => {
    // Exactly-once: the second plan must not be able to re-point the poll at
    // itself — the client is told which plan actually won.
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    storageMock.claimAvailabilityPollConversion.mockResolvedValue({
      claimed: false,
      convertedEventId: "event-first",
    });
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-second" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ alreadyConverted: true, convertedEventId: "event-first" });
  });
});
