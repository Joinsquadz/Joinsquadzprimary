import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * Ad-hoc polls have no squad and no event — the invitee roster IS the
 * participant list.
 *
 * That roster used to be invisible to the nudge gate and the range-update
 * fan-out, both of which only knew how to expand a squad or an event. The
 * result was backwards: the exact people a host hand-picked for a one-off plan
 * were the only ones who could never be nudged and never got told the dates
 * had moved. Both paths now share one participant collector, so they can't
 * drift apart again.
 */
const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  updateAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  createNudge: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  getUsers: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
  markPollUpdateNotified: vi.fn(),
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

const HOST = "host-id";
const FRIEND_A = "friend-a";
const FRIEND_B = "friend-b";
const OUTSIDER = "outsider-id";

const POLL_UPDATED_AT = new Date("2026-06-07T12:00:00.000Z");

const adhocPoll = {
  id: "poll-adhoc",
  squadId: null,
  eventId: null,
  participantIds: [FRIEND_A, FRIEND_B],
  createdBy: HOST,
  title: "Weekend?",
  days: ["2026-06-20", "2026-06-21"],
  slots: ["7PM"],
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: null,
  updatedBy: null,
  convertedEventId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getAvailabilityPoll.mockResolvedValue(adhocPoll);
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.getAvailabilityResponses.mockResolvedValue([]);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.getEvent.mockResolvedValue(null);
  storageMock.getUsers.mockResolvedValue([{ id: HOST, firstName: "Host" }]);
  storageMock.createNudge.mockResolvedValue({ applied: true, sentAt: new Date() });
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.getRecentNudgesFromUser.mockResolvedValue(new Map());
  storageMock.getLatestNudgeForUser.mockResolvedValue(null);
  storageMock.updateAvailabilityPoll.mockResolvedValue({
    ...adhocPoll,
    days: ["2026-07-04"],
    updatedAt: POLL_UPDATED_AT,
    updatedBy: HOST,
  });
});

describe("POST /api/availability/polls/:id/nudge — ad-hoc roster", () => {
  it("lets the host nudge someone from the hand-picked invitee list", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/availability/polls/poll-adhoc/nudge")
      .send({ targetUserId: FRIEND_A });

    expect(res.status).toBe(200);
    expect(storageMock.createNudge).toHaveBeenCalledWith(
      "poll-adhoc", HOST, FRIEND_A, expect.any(Number),
    );
  });

  it("still refuses a userId that isn't on the roster", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/availability/polls/poll-adhoc/nudge")
      .send({ targetUserId: OUTSIDER });

    expect(res.status).toBe(403);
    expect(storageMock.createNudge).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/availability/polls/:id — ad-hoc range-change push", () => {
  it("notifies the invitee roster when the host moves the dates", async () => {
    const app = await makeApp({ id: HOST });
    await request(app)
      .patch("/api/availability/polls/poll-adhoc")
      .send({ days: ["2026-07-04"] });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toContain(FRIEND_A);
    expect(recipientIds).toContain(FRIEND_B);
    // The host made the change — they don't need telling about it.
    expect(recipientIds).not.toContain(HOST);
  });
});
