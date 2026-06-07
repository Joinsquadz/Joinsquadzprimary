import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  updateAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  upsertAvailabilityResponse: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
  getSquad: vi.fn(),
  getEvent: vi.fn(),
  getUsers: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: sendPushNotificationsMock,
}));

import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const HOST_ID = "host-user-id";
const MEMBER_A = "member-a";
const MEMBER_B = "member-b";
const MEMBER_C = "member-c";

const OLD_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NEW_DAYS = ["2026-06-14", "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19", "2026-06-20"];
const SLOTS = ["6PM", "7PM", "8PM", "9PM", "10PM"];

const POLL_UPDATED_AT = new Date("2026-06-07T12:00:00.000Z");

const basePoll = {
  id: "poll-1",
  squadId: "squad-1",
  eventId: null,
  createdBy: HOST_ID,
  title: "When are you free?",
  days: OLD_DAYS,
  slots: SLOTS,
  createdAt: new Date(),
  updatedAt: null,
  updatedBy: null,
};

const updatedPoll = {
  ...basePoll,
  days: NEW_DAYS,
  updatedAt: POLL_UPDATED_AT,
  updatedBy: HOST_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.upsertAvailabilityResponse.mockResolvedValue({});
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("PATCH /api/availability/polls/:id — push notifications (squad-scoped)", () => {
  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue(updatedPoll);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A, MEMBER_B, MEMBER_C],
    });
  });

  it("does NOT send push notifications when only the title changes (range unchanged)", async () => {
    const titleOnlyPoll = { ...basePoll, title: "Updated Title" };
    storageMock.updateAvailabilityPoll.mockResolvedValue(titleOnlyPoll);
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ title: "Updated Title" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("does not include the host in push notification recipients", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    storageMock.getPushTokensForUsers.mockResolvedValue([
      "ExponentPushToken[host-token]",
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(HOST_ID);
  });

  it("excludes members who re-submitted AFTER the poll was updated", async () => {
    const afterUpdate = new Date(POLL_UPDATED_AT.getTime() + 60_000);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: afterUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(MEMBER_A);
  });

  it("includes members who responded BEFORE the poll was updated", async () => {
    const beforeUpdate = new Date(POLL_UPDATED_AT.getTime() - 60_000);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: beforeUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toContain(MEMBER_A);
  });

  it("includes members who have never responded at all", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
    expect(recipientIds).toContain(MEMBER_C);
    expect(recipientIds).not.toContain(HOST_ID);
  });

  it("excludes members who updated AND includes those who did not, simultaneously", async () => {
    const beforeUpdate = new Date(POLL_UPDATED_AT.getTime() - 60_000);
    const afterUpdate = new Date(POLL_UPDATED_AT.getTime() + 60_000);

    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: afterUpdate },
      { userId: MEMBER_B, cells: ["Tue-7PM"], updatedAt: beforeUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(HOST_ID);
    expect(recipientIds).not.toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
    expect(recipientIds).toContain(MEMBER_C);
  });

  it("skips sendPushNotifications entirely when no one needs a nudge", async () => {
    const afterUpdate = new Date(POLL_UPDATED_AT.getTime() + 60_000);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A],
    });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: afterUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("sends notifications with the correct squad-scoped data payload", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    storageMock.getPushTokensForUsers.mockResolvedValue([
      "ExponentPushToken[member-a-token]",
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(sendPushNotificationsMock).toHaveBeenCalled();
    });

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { title: string; body: string; data: Record<string, string> }];
    expect(payload.title).toBe("Availability poll updated");
    expect(payload.data.screen).toBe("availability");
    expect(payload.data.squadId).toBe("squad-1");
    expect(payload.data.eventId).toBeUndefined();
  });

  it("also nudges past responders who are no longer in the squad member list", async () => {
    const FORMER_MEMBER = "former-member";
    const beforeUpdate = new Date(POLL_UPDATED_AT.getTime() - 60_000);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A],
    });
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: FORMER_MEMBER, cells: ["Mon-6PM"], updatedAt: beforeUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toContain(FORMER_MEMBER);
  });
});

describe("PATCH /api/availability/polls/:id — push notifications (event-scoped)", () => {
  const eventPoll = {
    ...basePoll,
    id: "poll-event-1",
    squadId: null,
    eventId: "event-1",
    createdBy: HOST_ID,
    days: OLD_DAYS,
    slots: SLOTS,
    updatedAt: null,
    updatedBy: null,
  };

  const updatedEventPoll = {
    ...eventPoll,
    days: NEW_DAYS,
    updatedAt: POLL_UPDATED_AT,
    updatedBy: HOST_ID,
  };

  const baseEvent = {
    id: "event-1",
    hostId: HOST_ID,
    squadId: null,
    rsvps: { [MEMBER_A]: "yes", [MEMBER_B]: "maybe" },
  };

  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
    storageMock.updateAvailabilityPoll.mockResolvedValue(updatedEventPoll);
    storageMock.getEvent.mockResolvedValue(baseEvent);
    storageMock.getSquad.mockResolvedValue(null);
  });

  it("includes event RSVP members who have not responded", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-event-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(HOST_ID);
    expect(recipientIds).toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
  });

  it("excludes event RSVP members who already re-submitted after the update", async () => {
    const afterUpdate = new Date(POLL_UPDATED_AT.getTime() + 60_000);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: afterUpdate },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-event-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(HOST_ID);
    expect(recipientIds).not.toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
  });

  it("also pulls in squad members when the event is squad-scoped", async () => {
    const squadEvent = { ...baseEvent, squadId: "squad-1" };
    storageMock.getEvent.mockResolvedValue(squadEvent);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A, MEMBER_B, MEMBER_C],
    });
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-event-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).not.toContain(HOST_ID);
    expect(recipientIds).toContain(MEMBER_A);
    expect(recipientIds).toContain(MEMBER_B);
    expect(recipientIds).toContain(MEMBER_C);
  });

  it("sends notifications with the correct event-scoped data payload", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);
    storageMock.getPushTokensForUsers.mockResolvedValue([
      "ExponentPushToken[member-a-token]",
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .patch("/api/availability/polls/poll-event-1")
      .send({ days: NEW_DAYS });

    await vi.waitFor(() => {
      expect(sendPushNotificationsMock).toHaveBeenCalled();
    });

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { title: string; body: string; data: Record<string, string> }];
    expect(payload.data.screen).toBe("availability");
    expect(payload.data.eventId).toBe("event-1");
    expect(payload.data.squadId).toBeUndefined();
  });
});

// ─── PUT /api/availability/polls/:id/me — host notification ──────────────────

const RESPONSE_AT = new Date("2026-06-07T13:00:00.000Z"); // after POLL_UPDATED_AT

const pollWithUpdate = {
  ...basePoll,
  updatedAt: POLL_UPDATED_AT,
  updatedBy: HOST_ID,
};

describe("PUT /api/availability/polls/:id/me — host notification on re-submission", () => {
  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(pollWithUpdate);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: RESPONSE_AT },
    ]);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A],
    });
    storageMock.getPushTokensForUsers.mockResolvedValue([
      "ExponentPushToken[host-token]",
    ]);
    storageMock.getUsers.mockResolvedValue([
      { id: MEMBER_A, firstName: "Alice", lastName: null, email: null, profileImageUrl: null },
    ]);
  });

  it("sends a push notification to the poll creator when a member re-submits after an update", async () => {
    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await vi.waitFor(() => {
      expect(sendPushNotificationsMock).toHaveBeenCalled();
    });

    const [tokens, payload] = sendPushNotificationsMock.mock.calls[0] as [
      string[],
      { title: string; body: string; data: Record<string, string> },
    ];
    expect(tokens).toContain("ExponentPushToken[host-token]");
    expect(payload.title).toBe("Availability updated");
    expect(payload.body).toContain("Alice");
    expect(payload.data.screen).toBe("availability");
    expect(payload.data.squadId).toBe("squad-1");
  });

  it("fetches push tokens only for the poll creator, not for all members", async () => {
    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await vi.waitFor(() => {
      expect(storageMock.getPushTokensForUsers).toHaveBeenCalled();
    });

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toEqual([HOST_ID]);
  });

  it("skips the notification when the responding member is the poll creator", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: HOST_ID, cells: ["Mon-6PM"], updatedAt: RESPONSE_AT },
    ]);

    const app = await makeApp({ id: HOST_ID });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("skips the notification when the poll has never been updated (updatedAt is null)", async () => {
    storageMock.getAvailabilityPoll.mockResolvedValue(basePoll); // updatedAt: null

    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("skips the notification when the response timestamp predates the poll update", async () => {
    const beforeUpdate = new Date(POLL_UPDATED_AT.getTime() - 60_000);
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Mon-6PM"], updatedAt: beforeUpdate },
    ]);

    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("skips sendPushNotifications when the creator has no registered tokens", async () => {
    storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("sends with correct event-scoped data when the poll is event-scoped", async () => {
    const eventPollWithUpdate = {
      ...basePoll,
      id: "poll-event-1",
      squadId: null,
      eventId: "event-1",
      updatedAt: POLL_UPDATED_AT,
      updatedBy: HOST_ID,
    };
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPollWithUpdate);
    storageMock.getSquad.mockResolvedValue(null);

    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-event-1/me")
      .send({ cells: ["Mon-6PM"] });

    await vi.waitFor(() => {
      expect(sendPushNotificationsMock).toHaveBeenCalled();
    });

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [
      unknown,
      { data: Record<string, string> },
    ];
    expect(payload.data.screen).toBe("availability");
    expect(payload.data.eventId).toBe("event-1");
    expect(payload.data.squadId).toBeUndefined();
  });

  it("falls back to 'A member' in the notification body when user lookup returns nothing", async () => {
    storageMock.getUsers.mockResolvedValue([]);

    const app = await makeApp({ id: MEMBER_A });
    await request(app)
      .put("/api/availability/polls/poll-1/me")
      .send({ cells: ["Mon-6PM"] });

    await vi.waitFor(() => {
      expect(sendPushNotificationsMock).toHaveBeenCalled();
    });

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [
      unknown,
      { body: string },
    ];
    expect(payload.body).toContain("A member");
  });
});
