import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  createNudge: vi.fn(),
  getUsers: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
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
  // createNudge now enforces the debounce window itself (atomic upsert) and
  // reports whether this caller's nudge actually landed.
  storageMock.createNudge.mockResolvedValue({ applied: true, sentAt: new Date() });
  storageMock.getUsers.mockResolvedValue([{ id: CREATOR, firstName: "Cara" }]);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation((ids: string[]) => Promise.resolve(ids));
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
    expect(storageMock.createNudge).toHaveBeenCalledWith("poll-1", CREATOR, MEMBER, expect.any(Number));
  });

  it("does not look up push tokens when the target is muted in the squad", async () => {
    storageMock.filterUnmutedForSquad.mockResolvedValue([]);

    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-1/nudge")
      .send({ targetUserId: MEMBER });

    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith([MEMBER], "squad-1");
    expect(storageMock.getPushTokensForUsers).not.toHaveBeenCalled();
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
      // "going" / "maybe" are the ACTIVE statuses; a participant list built
      // from any historical RSVP key would also include people who declined.
      rsvps: { [RSVP_USER]: "going" },
    });
  });

  it("allows nudging an event RSVP participant", async () => {
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/nudge")
      .send({ targetUserId: RSVP_USER });
    expect(res.status).toBe(200);
    expect(storageMock.createNudge).toHaveBeenCalledWith("poll-evt", CREATOR, RSVP_USER, expect.any(Number));
  });

  it("returns 429 with a retry hint when the atomic upsert rejects a nudge inside the debounce window", async () => {
    // The debounce decision belongs to the single upsert now: when it reports
    // `applied: false` the route must translate that into a 429, not a 500 from
    // the (poll, target) unique constraint.
    storageMock.createNudge.mockResolvedValue({
      applied: false,
      sentAt: new Date(Date.now() - 60_000),
    });
    const app = await makeApp({ id: CREATOR });
    const res = await request(app)
      .post("/api/availability/polls/poll-evt/nudge")
      .send({ targetUserId: RSVP_USER });
    expect(res.status).toBe(429);
    expect(res.body.debounced).toBe(true);
    expect(res.body.retryAfterSec).toBeGreaterThan(0);
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
