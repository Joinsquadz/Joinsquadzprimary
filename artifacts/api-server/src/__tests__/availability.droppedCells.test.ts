import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  upsertAvailabilityResponse: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../lib/logger");

import availabilityRouter from "../routes/availability";
import { makeTestApp } from "./helpers/makeTestApp";

const makeApp = () => makeTestApp(availabilityRouter, { id: "user-1" });

const basePoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  createdBy: "user-1",
  title: "When are you free?",
  days: ["Mon", "Tue", "Wed"],
  slots: ["6PM", "7PM", "8PM"],
  createdAt: new Date(),
};

const datedPoll = {
  ...basePoll,
  id: "poll-dated",
  days: ["2026-06-13", "2026-06-14", "2026-06-15"],
  slots: ["6PM", "7PM", "8PM", "9PM"],
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.upsertAvailabilityResponse.mockResolvedValue({});
  storageMock.getAvailabilityResponses.mockResolvedValue([]);
});

describe("PUT /api/availability/polls/:id/me — droppedCount", () => {
  it("reports droppedCount=0 when every cell is in the poll grid", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: "user-1", cells: ["Mon-6PM", "Tue-7PM", "Wed-8PM"] },
    ]);

    const app = await makeApp();
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM", "Tue-7PM", "Wed-8PM"] });

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(0);
    expect(res.body.myCells).toEqual(["Mon-6PM", "Tue-7PM", "Wed-8PM"]);
  });

  it("reports droppedCount equal to the number of out-of-grid cells sent", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: "user-1", cells: ["Mon-6PM"] },
    ]);

    const app = await makeApp();
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({
        cells: [
          "Mon-6PM",
          "Mon-3AM",
          "Sun-9PM",
          "bogus",
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(3);
    expect(res.body.myCells).toEqual(["Mon-6PM"]);
  });

  it("reports droppedCount equal to all cells when none are in the grid", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: "user-1", cells: [] },
    ]);

    const app = await makeApp();
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Sat-3AM", "Sun-11AM", "invalid"] });

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(3);
    expect(res.body.myCells).toEqual([]);
  });

  it("counts each unique invalid cell once (duplicates are deduplicated before dropping)", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: "user-1", cells: ["Mon-6PM"] },
    ]);

    const app = await makeApp();
    const res = await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({
        cells: [
          "Mon-6PM",
          "Mon-6PM",
          "bogus",
          "bogus",
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(1);
    expect(res.body.myCells).toEqual(["Mon-6PM"]);
  });

  it("reports droppedCount correctly for ISO-date poll cells", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(datedPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: "user-1", cells: ["2026-06-13-6PM", "2026-06-14-9PM"] },
    ]);

    const app = await makeApp();
    const res = await request(app)
      .put("/api/availability/polls/poll-dated/me")
      .send({
        cells: [
          "2026-06-13-6PM",
          "2026-06-14-9PM",
          "2026-06-16-8PM",
          "2026-06-14-3AM",
          "Sat-8PM",
          "bogus",
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.droppedCount).toBe(4);
    expect(res.body.myCells).toEqual(["2026-06-13-6PM", "2026-06-14-9PM"]);
  });
});
