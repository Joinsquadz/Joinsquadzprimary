// A1/A2 — material-edit push behaviour:
//   A1: push fires only on time/location/title changes, not description/emoji-only
//       edits; debounce collapses multiple edits within a 5-min window.
//   A2: cancellation push fires exactly once (false→true edge); re-saving an
//       already-cancelled event returns 410, so push never re-fires.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    rsvps: "rsvps",
    type: "type",
    squadId: "squad_id",
    eventAt: "event_at",
    endAt: "end_at",
    createdAt: "created_at",
    version: "version",
    invitedUserIds: "invited_user_ids",
    cancelled: "cancelled",
    materialEditNotifiedAt: "material_edit_notified_at",
  },
  eventInvitesTable: {
    id: "id",
    eventId: "event_id",
    inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id",
    status: "status",
    createdAt: "created_at",
  },
}));

const pushMock = vi.hoisted(() => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/pushNotifications", () => pushMock);

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "host-user-id", name: "Host" }),
    upsertUser: vi.fn().mockResolvedValue({ id: "host-user-id" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getFriendIds: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue([
      "ExponentPushToken[rsvp-token]",
    ]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/logger");

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = () => makeTestApp(eventsRouter, { id: HOST_ID });

// Helper: event that hasn't been notified yet (cold debounce state).
function freshEvent(overrides: Record<string, unknown> = {}) {
  return makeBaseEvent({
    version: 0,
    date: "2026-09-01",
    location: "Somewhere",
    title: "Test Event",
    emoji: "🎉",
    description: "",
    cancelled: false,
    materialEditNotifiedAt: null,
    rsvps: { [RSVP_USER_ID]: "going" },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pushMock.sendPushNotifications.mockResolvedValue(undefined);
});

// ── A1: material-field push ───────────────────────────────────────────────────

describe("A1 — material-edit push fires on time, location, or title changes", () => {
  it("fires when the date changes to a concrete value", async () => {
    const ev = freshEvent();
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, date: "2026-10-01", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ date: "2026-10-01", version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
  });

  it("fires when the location changes", async () => {
    const ev = freshEvent();
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, location: "New Venue", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ location: "New Venue", version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
  });

  it("fires when the title changes", async () => {
    const ev = freshEvent();
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, title: "Renamed Party", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ title: "Renamed Party", version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
  });

  it("does NOT fire when only the description changes", async () => {
    const ev = freshEvent();
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, description: "Updated notes", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ description: "Updated notes", version: 0 });
    expect(res.status).toBe(200);
    // Give async push time to fire if it were going to.
    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("does NOT fire when only the emoji changes", async () => {
    const ev = freshEvent();
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, emoji: "🌟", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ emoji: "🌟", version: 0 });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });
});

// ── A1: 5-minute debounce collapses multiple edits ───────────────────────────

describe("A1 — 5-minute debounce: second material edit within window skips push", () => {
  it("suppresses the push when materialEditNotifiedAt is within the last 5 minutes", async () => {
    // Simulate the event having already been notified 1 minute ago.
    const recentNotifiedAt = new Date(Date.now() - 60_000).toISOString();
    const ev = freshEvent({ materialEditNotifiedAt: recentNotifiedAt, location: "Old Venue" });
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, location: "New Venue", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ location: "New Venue", version: 0 });
    expect(res.status).toBe(200);
    // Cooldown is active — push is suppressed.
    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("fires the push when materialEditNotifiedAt is older than 5 minutes", async () => {
    // Notified 6 minutes ago — outside the debounce window.
    const oldNotifiedAt = new Date(Date.now() - 6 * 60_000).toISOString();
    const ev = freshEvent({ materialEditNotifiedAt: oldNotifiedAt, location: "Old Venue" });
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, location: "New Venue", version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ location: "New Venue", version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
  });
});

// ── A2: cancellation push fires exactly once ──────────────────────────────────

describe("A2 — cancellation push: fires exactly once on the false→true edge", () => {
  it("fires the cancel push when cancelled transitions false→true", async () => {
    const ev = freshEvent({ cancelled: false });
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, cancelled: true, version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
    const [, notification] = pushMock.sendPushNotifications.mock.calls[0] as [
      unknown,
      { title: string; body: string },
    ];
    expect(notification.title).toMatch(/cancelled/i);
  });

  it("does NOT fire a material-edit push after a cancel (cancel supersedes edit push)", async () => {
    const ev = freshEvent({ cancelled: false, materialEditNotifiedAt: null });
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, cancelled: true, version: 1 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 0 });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalledTimes(1));
    // Only one push (the cancel notification), not an additional edit push.
    expect(pushMock.sendPushNotifications).toHaveBeenCalledTimes(1);
  });

  it("returns 410 (not 200) when re-saving cancelled:true on an already-cancelled event", async () => {
    const ev = freshEvent({ cancelled: true });
    mockRows.value = [ev];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 0 });
    // The 410 gate fires before any push is attempted.
    expect(res.status).toBe(410);
    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("excludes the host from cancellation push recipients", async () => {
    const ev = freshEvent({ cancelled: false, rsvps: { [RSVP_USER_ID]: "going" } });
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, cancelled: true, version: 1 }];
    await request(makeApp()).patch("/api/events/evt-1").send({ cancelled: true, version: 0 });
    await vi.waitFor(() => expect(pushMock.sendPushNotifications).toHaveBeenCalled());
    // getPushTokensForUsers was called for the audience (RSVP members), not the host.
    const { storage } = await import("../storage");
    const storageMock = storage as unknown as { getPushTokensForUsers: ReturnType<typeof vi.fn> };
    const [audienceArg] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
    expect(audienceArg).not.toContain(HOST_ID);
  });
});
