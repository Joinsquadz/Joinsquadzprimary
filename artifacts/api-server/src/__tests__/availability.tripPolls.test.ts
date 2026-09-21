// Route-level behaviour for trip polls: explicit `kind`, an independent trip
// length, the best-stretch result, and duration-only edits.
//
// The invariant these tests protect: the voting window ("days") and the trip
// itself ("tripLengthDays") are two DIFFERENT spans. Conflating them is what
// made trip polls answer with a single day.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  createAvailabilityPoll: vi.fn(),
  updateAvailabilityPoll: vi.fn(),
  findAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  markPollUpdateNotified: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  clearPushToken: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  getUsers: vi.fn(),
  getRecentNudgesFromUser: vi.fn(),
  getLatestNudgeForUser: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/availabilityEvents", () => ({
  emitPollUpdate: vi.fn(),
  onPollUpdate: vi.fn(),
}));
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));

import availabilityRouter from "../routes/availability";
import { DEFAULT_POLL_DAY_COUNT } from "../lib/pollDefaults";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const HOST_ID = "host-user-id";
const MEMBER_A = "member-a";
const MEMBER_B = "member-b";

const DAYS = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];
const TRIP_SLOTS = ["All day"];

const cells = (...days: string[]) => days.map((d) => `${d}-All day`);

const tripPoll = {
  id: "poll-trip",
  squadId: "squad-1",
  eventId: null,
  participantIds: null,
  createdBy: HOST_ID,
  title: "Summer trip",
  days: DAYS,
  slots: TRIP_SLOTS,
  kind: "trip" as const,
  tripLengthDays: 3,
  createdAt: new Date(),
  updatedAt: null,
  updatedBy: null,
  convertedEventId: null,
  pollUpdateNotifiedAt: null,
};

/** A trip poll from before trip length existed — never asked how long it was. */
const legacyTripPoll = { ...tripPoll, id: "poll-legacy", tripLengthDays: null };

const eventPoll = {
  ...tripPoll,
  id: "poll-event",
  kind: "event" as const,
  tripLengthDays: null,
  slots: ["6PM", "7PM"],
};

const resp = (userId: string, updatedAt: Date, ...days: string[]) => ({
  userId,
  cells: cells(...days),
  updatedAt,
});

const AT = new Date("2026-05-20T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [HOST_ID, MEMBER_A, MEMBER_B] });
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getAvailabilityResponses.mockResolvedValue([]);
  storageMock.getRecentNudgesFromUser.mockResolvedValue(new Map());
  storageMock.getLatestNudgeForUser.mockResolvedValue(null);
  storageMock.findAvailabilityPoll.mockResolvedValue(null);
  storageMock.markPollUpdateNotified.mockResolvedValue(undefined);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation((ids: string[]) => Promise.resolve(ids));
});

describe("POST /api/availability/polls — trip kind and length", () => {
  it("persists an explicit trip kind and length", async () => {
    storageMock.createAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: TRIP_SLOTS, kind: "trip", tripLengthDays: 3 });

    expect(res.status).toBe(201);
    expect(storageMock.createAvailabilityPoll).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "trip", tripLengthDays: 3 }),
    );
    expect(res.body.poll).toMatchObject({ kind: "trip", tripLengthDays: 3 });
  });

  it("rejects a trip longer than the window people are voting on", async () => {
    // Clamping silently would hand the organizer a shorter trip than the one
    // they asked for, which they'd only notice after everyone had voted.
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: TRIP_SLOTS, kind: "trip", tripLengthDays: 9 });

    expect(res.status).toBe(400);
    expect(storageMock.createAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("persists a length on a MULTI-DAY EVENT poll", async () => {
    // Duration belongs to the plan, not to its type: a two-day festival is an
    // event that still needs the best consecutive run of days.
    storageMock.createAvailabilityPoll.mockResolvedValue({ ...eventPoll, tripLengthDays: 3 });
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: ["6PM"], kind: "event", tripLengthDays: 3 });

    expect(res.status).toBe(201);
    expect(storageMock.createAvailabilityPoll).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "event", tripLengthDays: 3 }),
    );
    expect(res.body.poll).toMatchObject({ kind: "event", tripLengthDays: 3 });
  });

  it("rejects a multi-day event longer than the window people are voting on", async () => {
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: ["6PM"], kind: "event", tripLengthDays: 9 });

    expect(res.status).toBe(400);
    expect(storageMock.createAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("rejects a trip longer than the DEFAULT window when no days are sent", async () => {
    // Omitting days doesn't mean "no window" — storage fills in a default
    // range, so the poll is still created against a concrete window. Skipping
    // the check here would persist a 31-day trip with no rankable stretch.
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", slots: TRIP_SLOTS, kind: "trip", tripLengthDays: 31 });

    expect(res.status).toBe(400);
    expect(storageMock.createAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("allows a trip exactly as long as the default window when no days are sent", async () => {
    // Boundary on the same path: the trip may fill the default window.
    storageMock.createAvailabilityPoll.mockResolvedValue({
      ...tripPoll,
      tripLengthDays: DEFAULT_POLL_DAY_COUNT,
    });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app).post("/api/availability/polls").send({
      squadId: "squad-1",
      slots: TRIP_SLOTS,
      kind: "trip",
      tripLengthDays: DEFAULT_POLL_DAY_COUNT,
    });

    expect(res.status).toBe(201);
    expect(storageMock.createAvailabilityPoll).toHaveBeenCalledWith(
      expect.objectContaining({ tripLengthDays: DEFAULT_POLL_DAY_COUNT }),
    );
  });

  it("rejects a one-day trip", async () => {
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: TRIP_SLOTS, kind: "trip", tripLengthDays: 1 });

    expect(res.status).toBe(400);
  });

  it("stores no length for a one-day event poll", async () => {
    storageMock.createAvailabilityPoll.mockResolvedValue(eventPoll);
    const app = await makeApp({ id: HOST_ID });

    await request(app)
      .post("/api/availability/polls")
      .send({ squadId: "squad-1", days: DAYS, slots: ["6PM", "7PM"] });

    expect(storageMock.createAvailabilityPoll).toHaveBeenCalledWith(
      expect.objectContaining({ tripLengthDays: null }),
    );
  });
});

describe("GET /api/availability/polls/:id — bestStretch", () => {
  it("answers a trip poll with a consecutive run of days", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-01", "2026-06-02", "2026-06-03"),
      resp(MEMBER_B, AT, "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-trip");

    expect(res.status).toBe(200);
    expect(res.body.bestStretch).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      lengthDays: 3,
      count: 2,
      partial: false,
    });
  });

  it("marks the result partial when nobody clears the whole run", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-01", "2026-06-02"),
      resp(MEMBER_B, AT, "2026-06-03"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-trip");

    expect(res.body.bestStretch).toMatchObject({ partial: true, count: 0 });
  });

  it("leaves a legacy trip poll on its original single-day result", async () => {
    // These polls were never asked how long the trip is, so inventing a length
    // would change an existing poll's answer under its organizer.
    storageMock.getAvailabilityPoll.mockResolvedValue(legacyTripPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-02"),
      resp(MEMBER_B, AT, "2026-06-02"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-legacy");

    expect(res.body.bestStretch).toBeNull();
    expect(res.body.best).toMatchObject({ cell: "2026-06-02-All day", count: 2 });
  });

  it("gives a one-day event poll no stretch at all", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["2026-06-01-6PM"], updatedAt: AT },
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-event");

    expect(res.body.bestStretch).toBeNull();
    expect(res.body.poll).toMatchObject({ kind: "event", tripLengthDays: null });
  });

  it("ranks a MULTI-DAY EVENT poll by consecutive stretch, like a trip", async () => {
    // Same ranking, different plan type: the event runs two days, so the answer
    // has to be a run of days rather than one winning cell.
    storageMock.getAvailabilityPoll.mockResolvedValue({
      ...eventPoll,
      id: "poll-event-2day",
      tripLengthDays: 2,
    });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["2026-06-02-6PM", "2026-06-03-6PM"], updatedAt: AT },
      { userId: MEMBER_B, cells: ["2026-06-02-6PM", "2026-06-03-6PM"], updatedAt: AT },
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-event-2day");

    expect(res.status).toBe(200);
    expect(res.body.bestStretch).toMatchObject({
      startDate: "2026-06-02",
      endDate: "2026-06-03",
      lengthDays: 2,
      count: 2,
      partial: false,
    });
  });

  it("keeps the single-cell `best` alongside the stretch for compatibility", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-01", "2026-06-02", "2026-06-03"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-trip");

    expect(res.body.best).not.toBeNull();
    expect(res.body.bestStretch).not.toBeNull();
  });
});

describe("PATCH /api/availability/polls/:id — trip length", () => {
  it("accepts a duration-only change without touching the grid", async () => {
    // The key non-destructive property: no days/slots go to storage, so the
    // trim pass never runs and nobody's answers are dropped.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: 2 });

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: 2 });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-trip",
      { tripLengthDays: 2 },
      HOST_ID,
    );
    expect(res.body.poll).toMatchObject({ tripLengthDays: 2 });
  });

  it("re-ranks the stretch after a duration change", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: 2 });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-04", "2026-06-05"),
      resp(MEMBER_B, AT, "2026-06-04", "2026-06-05"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: 2 });

    expect(res.body.bestStretch).toMatchObject({
      startDate: "2026-06-04",
      endDate: "2026-06-05",
      lengthDays: 2,
      count: 2,
    });
  });

  it("rejects a duration-only change longer than the poll's EXISTING window", async () => {
    // The request body alone looks fine — it carries no days at all — so this
    // can only be caught against the poll being edited. Letting it through
    // would store a 31-day trip on a 5-day window: the edit "succeeds" and the
    // poll then quietly has no rankable stretch.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: 31 });

    expect(res.status).toBe(400);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("gives an EVENT poll a length and re-ranks it as a stretch", async () => {
    // A one-day event that grows into a two-day plan: the same PATCH path a
    // trip uses, because duration is a property of the plan, not its type.
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...eventPoll, tripLengthDays: 2 });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["2026-06-01-6PM", "2026-06-02-6PM"], updatedAt: AT },
    ]);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-event")
      .send({ tripLengthDays: 2 });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-event",
      { tripLengthDays: 2 },
      HOST_ID,
    );
    expect(res.body.bestStretch).toMatchObject({ lengthDays: 2, count: 1 });
  });

  // The way back. A host who makes an event 2 days and then thinks better of it
  // must be able to return it to a single day — and "one day" is stored as NO
  // length, so this is a CLEAR, not a value of 1 (the server rejects 1).
  it("clears a multi-day EVENT's length back to a single-day plan", async () => {
    const multiDayEvent = { ...eventPoll, tripLengthDays: 2 };
    storageMock.getAvailabilityPoll.mockResolvedValue(multiDayEvent);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...eventPoll, tripLengthDays: null });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["2026-06-01-6PM", "2026-06-02-6PM"], updatedAt: AT },
    ]);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-event")
      .send({ tripLengthDays: null });

    expect(res.status).toBe(200);
    // Explicit null must reach storage: dropping it would leave the poll
    // stretch-ranked, which is exactly the bug this covers.
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-event",
      { tripLengthDays: null },
      HOST_ID,
    );
    // Back to the single-best-cell answer, with no stretch offered.
    expect(res.body.poll).toMatchObject({ tripLengthDays: null });
    expect(res.body.bestStretch ?? null).toBeNull();
  });

  it("clears a TRIP's length back to the legacy single-day behavior", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: null });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: cells("2026-06-01"), updatedAt: AT },
    ]);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: null });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-trip",
      { tripLengthDays: null },
      HOST_ID,
    );
    expect(res.body.bestStretch ?? null).toBeNull();
  });

  // A clear can't be "too long", so the window guard must not measure the
  // length being removed — nor fall back to the stored one it's replacing.
  it("allows clearing a length that no longer fits a shrunken window", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: 5 });
    storageMock.updateAvailabilityPoll.mockResolvedValue({
      ...tripPoll,
      days: DAYS.slice(0, 2),
      tripLengthDays: null,
    });
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: DAYS.slice(0, 2), tripLengthDays: null });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-trip",
      expect.objectContaining({ tripLengthDays: null }),
      HOST_ID,
    );
  });

  // Omission and null are different requests. Omitting the field means "leave
  // the length alone"; if the two were conflated, every title-only edit would
  // wipe the poll's duration.
  it("leaves the stored length untouched when the field is omitted", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ title: "Renamed" });

    expect(res.status).toBe(200);
    const [, updates] = storageMock.updateAvailabilityPoll.mock.calls[0];
    expect(updates).not.toHaveProperty("tripLengthDays");
  });

  it("rejects an event length longer than the poll's existing window", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-event")
      .send({ tripLengthDays: 31 });

    expect(res.status).toBe(400);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("accepts a length exactly equal to the existing window", async () => {
    // Boundary: the trip may fill the window entirely, just not exceed it.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: 5 });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: DAYS.length });

    expect(res.status).toBe(200);
  });

  it("validates a widened window and a new length together", async () => {
    // days + length in one patch: the length must be judged against the days
    // this patch INSTALLS, not the ones being replaced.
    storageMock.getAvailabilityPoll.mockResolvedValue({ ...tripPoll, days: ["2026-06-01", "2026-06-02"] });
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, tripLengthDays: 4 });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: DAYS, tripLengthDays: 4 });

    expect(res.status).toBe(200);
  });

  it("rejects SHRINKING the window under the trip's existing length", async () => {
    // No tripLengthDays in the body at all — but the poll already has a 3-day
    // trip, so cutting the window to 2 dates leaves a trip that cannot fit.
    // The mobile editor happens to send the length; the API cannot rely on that.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: ["2026-06-01", "2026-06-02"] });

    expect(res.status).toBe(400);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("allows shrinking the window down to exactly the trip length", async () => {
    // Boundary on the same path: 3 dates still fit a 3-day trip.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const shrunk = ["2026-06-01", "2026-06-02", "2026-06-03"];
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...tripPoll, days: shrunk });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: shrunk });

    expect(res.status).toBe(200);
  });

  it("lets a days-only patch shorten the trip when the length comes down too", async () => {
    // Both fields move together: the new length is judged against the new days.
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const shrunk = ["2026-06-01", "2026-06-02"];
    storageMock.updateAvailabilityPoll.mockResolvedValue({
      ...tripPoll,
      days: shrunk,
      tripLengthDays: 2,
    });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: shrunk, tripLengthDays: 2 });

    expect(res.status).toBe(200);
  });

  it("lets a LEGACY trip shrink its window freely", async () => {
    // A legacy trip has no recorded length, so there is nothing to outgrow —
    // the new guard must not start rejecting edits that always worked.
    storageMock.getAvailabilityPoll.mockResolvedValue(legacyTripPoll);
    const shrunk = ["2026-06-01", "2026-06-02"];
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...legacyTripPoll, days: shrunk });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-legacy")
      .send({ days: shrunk });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalled();
  });

  it("lets an EVENT poll shrink its window freely", async () => {
    // Event polls have no trip length; the guard must not touch them.
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    const shrunk = ["2026-06-01"];
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...eventPoll, days: shrunk });
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-event")
      .send({ days: shrunk });

    expect(res.status).toBe(200);
  });

  it("rejects a new length longer than the new window", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: HOST_ID });

    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ days: ["2026-06-01", "2026-06-02"], tripLengthDays: 4 });

    expect(res.status).toBe(400);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("gives a legacy trip poll a length without disturbing the grid", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(legacyTripPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue({ ...legacyTripPoll, tripLengthDays: 3 });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      resp(MEMBER_A, AT, "2026-06-01", "2026-06-02", "2026-06-03"),
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/availability/polls/poll-legacy")
      .send({ tripLengthDays: 3 });

    expect(res.status).toBe(200);
    expect(storageMock.updateAvailabilityPoll).toHaveBeenCalledWith(
      "poll-legacy",
      { tripLengthDays: 3 },
      HOST_ID,
    );
    expect(res.body.bestStretch).toMatchObject({ lengthDays: 3, count: 1 });
  });

  it("still rejects a patch that changes nothing", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).patch("/api/availability/polls/poll-trip").send({});
    expect(res.status).toBe(400);
  });

  it("still refuses a non-creator", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(tripPoll);
    const app = await makeApp({ id: MEMBER_A });
    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: 2 });

    expect(res.status).toBe(403);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });

  it("still refuses to edit a poll that was already converted", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue({
      ...tripPoll,
      convertedEventId: "event-9",
    });
    const app = await makeApp({ id: HOST_ID });
    const res = await request(app)
      .patch("/api/availability/polls/poll-trip")
      .send({ tripLengthDays: 2 });

    expect(res.status).toBe(409);
    expect(storageMock.updateAvailabilityPoll).not.toHaveBeenCalled();
  });
});
