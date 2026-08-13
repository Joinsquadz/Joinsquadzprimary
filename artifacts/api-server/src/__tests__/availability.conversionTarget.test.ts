import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * Conversion has to validate the plan it's pointing at.
 *
 * The route used to stamp whatever `eventId` the client sent straight onto the
 * poll, so a typo'd or deleted id left the poll permanently terminal with a
 * dangling pointer — "this poll is closed", tap through, nothing there. Worse,
 * an id belonging to someone else's plan would happily stick. The target must
 * exist, be visible to the converter, and belong to the same scope as the poll.
 */
const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  claimAvailabilityPollConversion: vi.fn(),
  getEvent: vi.fn(),
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

const CREATOR = "creator-id";

const squadPoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  participantIds: null,
  createdBy: CREATOR,
  days: ["2026-06-20"],
  slots: ["7PM"],
  convertedEventId: null,
};

const eventPoll = { ...squadPoll, id: "poll-evt", squadId: null, eventId: "event-own" };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.claimAvailabilityPollConversion.mockResolvedValue({
    claimed: true,
    convertedEventId: "event-9",
  });
  storageMock.getEvent.mockResolvedValue({ id: "event-9", hostId: CREATOR, squadId: "squad-1" });
});

describe("POST /api/availability/polls/:id/convert — target validation", () => {
  it("404s instead of stamping a plan that doesn't exist", async () => {
    storageMock.getEvent.mockResolvedValue(null);
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-ghost" });

    expect(res.status).toBe(404);
    // Critically, the poll is NOT left terminal pointing at nothing.
    expect(storageMock.claimAvailabilityPollConversion).not.toHaveBeenCalled();
  });

  it("403s when the converter can't even see the target plan", async () => {
    storageMock.canAccessAvailabilityPoll.mockResolvedValue(false);
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-9" });

    expect(res.status).toBe(403);
    expect(storageMock.claimAvailabilityPollConversion).not.toHaveBeenCalled();
  });

  it("400s when a squad poll is pointed at a plan in a different squad", async () => {
    storageMock.getEvent.mockResolvedValue({ id: "event-9", hostId: CREATOR, squadId: "squad-other" });
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/convert")
      .send({ eventId: "event-9" });

    expect(res.status).toBe(400);
    expect(storageMock.claimAvailabilityPollConversion).not.toHaveBeenCalled();
  });

  it("400s when an event-scoped poll is pointed at some other plan", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.getEvent.mockResolvedValue({ id: "event-else", hostId: CREATOR, squadId: null });
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/convert")
      .send({ eventId: "event-else" });

    expect(res.status).toBe(400);
    expect(storageMock.claimAvailabilityPollConversion).not.toHaveBeenCalled();
  });

  it("converts an event-scoped poll into its OWN plan", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.getEvent.mockResolvedValue({ id: "event-own", hostId: CREATOR, squadId: null });
    storageMock.claimAvailabilityPollConversion.mockResolvedValue({
      claimed: true,
      convertedEventId: "event-own",
    });
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/convert")
      .send({ eventId: "event-own" });

    expect(res.status).toBe(200);
    expect(storageMock.claimAvailabilityPollConversion).toHaveBeenCalledWith("poll-evt", "event-own");
  });
});
