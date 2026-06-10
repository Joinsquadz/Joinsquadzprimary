import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  getRecentNudge: vi.fn(),
  createNudge: vi.fn(),
  getUsers: vi.fn(),
  getPushTokensForUsers: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: () => Promise.resolve([]) }));

import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const CREATOR = "creator-id";
const MEMBER = "member-id";
const OUTSIDER = "outsider-id";

const squadPoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  createdBy: CREATOR,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
  storageMock.getAvailabilityResponses.mockResolvedValue([]);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [CREATOR, MEMBER] });
  storageMock.getRecentNudge.mockResolvedValue(null);
  storageMock.createNudge.mockResolvedValue(undefined);
  storageMock.getUsers.mockResolvedValue([{ id: CREATOR, firstName: "Cara" }]);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
});

describe("POST /api/availability/polls/:id/nudge — participant membership", () => {
  it("returns 403 when nudging someone who is not a member of the poll's squad", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/nudge")
      .send({ targetUserId: OUTSIDER });
    expect(res.status).toBe(403);
    expect(storageMock.createNudge).not.toHaveBeenCalled();
  });

  it("allows nudging a pending member of the poll's squad", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/nudge")
      .send({ targetUserId: MEMBER });
    expect(res.status).toBe(200);
    expect(storageMock.createNudge).toHaveBeenCalledWith("poll-1", CREATOR, MEMBER);
  });

  it("returns 403 when a non-creator attempts to nudge", async () => {
    const app = await makeApp({ id: MEMBER });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/nudge")
      .send({ targetUserId: CREATOR });
    expect(res.status).toBe(403);
    expect(storageMock.createNudge).not.toHaveBeenCalled();
  });
});

describe("POST /api/availability/polls/:id/nudge — event-scoped participants", () => {
  const RSVP_USER = "rsvp-user-id";
  const EVENT_SQUAD_MEMBER = "event-squad-member-id";
  const eventPoll = { id: "poll-evt", squadId: null, eventId: "evt-1", createdBy: CREATOR };

  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.getSquad.mockResolvedValue({ id: "squad-9", memberIds: [CREATOR, EVENT_SQUAD_MEMBER] });
    storageMock.getEvent.mockResolvedValue({
      id: "evt-1",
      hostId: CREATOR,
      squadId: "squad-9",
      rsvps: { [RSVP_USER]: "yes" },
    });
  });

  it("allows nudging an event RSVP participant", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/nudge")
      .send({ targetUserId: RSVP_USER });
    expect(res.status).toBe(200);
    expect(storageMock.createNudge).toHaveBeenCalledWith("poll-evt", CREATOR, RSVP_USER);
  });

  it("allows nudging a member of the event's squad", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/nudge")
      .send({ targetUserId: EVENT_SQUAD_MEMBER });
    expect(res.status).toBe(200);
  });

  it("returns 403 for someone outside the event host/RSVP/squad union", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/nudge")
      .send({ targetUserId: OUTSIDER });
    expect(res.status).toBe(403);
    expect(storageMock.createNudge).not.toHaveBeenCalled();
  });
});
