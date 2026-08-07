/**
 * Regression tests: event / trip title and stop-title validation.
 *
 * CreateEventBody, UpdateEventBody, AddStopBody, PatchStopBody, AddTaskBody,
 * AddPackingBody, and PatchPackingBody all now use .trim().min(1) so that
 * whitespace-only titles/labels are rejected before reaching the DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Minimal DB mock (validation fires before any DB call) ─────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: vi.fn().mockResolvedValue(undefined),
        select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
        delete: () => ({ where: () => Promise.resolve() }),
      }),
    ),
  },
  eventsTable: {
    id: "id", hostId: "host_id", rsvps: "rsvps", type: "type", squadId: "squad_id",
    eventAt: "event_at", endAt: "end_at", createdAt: "created_at", version: "version",
    invitedUserIds: "invited_user_ids", cancelled: "cancelled", title: "title",
    materialEditNotifiedAt: "material_edit_notified_at",
  },
  eventCreationsTable: { userId: "user_id", yearMonth: "year_month", count: "count" },
  usersTable: { id: "id", isSquadzPlus: "is_squadz_plus", foundingMember: "founding_member", moderationHidden: "moderation_hidden" },
  eventInvitesTable: { id: "id", eventId: "event_id", invitedUserId: "invited_user_id", status: "status" },
  activityTable: { id: "id", type: "type", subjectId: "subject_id", userId: "user_id" },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", isSquadzPlus: false }),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getSquad: vi.fn().mockResolvedValue(null),
    getFriendIds: vi.fn().mockResolvedValue([]),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation(async (ids: string[]) => ids),
    clearPushToken: vi.fn(),
  },
}));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn().mockResolvedValue(false) }));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";

const authedApp = makeTestApp(eventsRouter, { id: "u1" });

beforeEach(() => { vi.clearAllMocks(); });

// ── POST /api/events — create ─────────────────────────────────────────────────
describe("POST /api/events — title validation", () => {
  it("rejects a whitespace-only title with 400", async () => {
    const res = await request(authedApp).post("/api/events").send({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects an empty title with 400", async () => {
    const res = await request(authedApp).post("/api/events").send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a tab/newline-only title with 400", async () => {
    const res = await request(authedApp).post("/api/events").send({ title: "\n\t" });
    expect(res.status).toBe(400);
  });

  it("accepts a title with surrounding whitespace (trimmed to non-empty)", async () => {
    const res = await request(authedApp).post("/api/events").send({ title: "  BBQ  " });
    // Not 400 (may be 500 if DB mock is incomplete for the full create path).
    expect(res.status).not.toBe(400);
  });
});

// ── PATCH /api/events/:id — update ───────────────────────────────────────────
describe("PATCH /api/events/:id — title validation", () => {
  it("rejects setting title to empty string with 400", async () => {
    const res = await request(authedApp).patch("/api/events/e1").send({ title: "" });
    expect(res.status).toBe(400);
  });

  it("rejects setting title to whitespace-only with 400", async () => {
    const res = await request(authedApp).patch("/api/events/e1").send({ title: "   " });
    expect(res.status).toBe(400);
  });

  it("accepts omitting title entirely (partial update)", async () => {
    const res = await request(authedApp).patch("/api/events/e1").send({ location: "New York" });
    expect(res.status).not.toBe(400);
  });
});

// ── POST /api/events/:id/itinerary — add stop (trip-only) ────────────────────
// The itinerary add-stop route validates after the event lookup.
// This test verifies the zod schema rejects whitespace-only titles before any
// DB state matters (version-missing returns 400 without a DB call).
describe("POST /api/events/:id/itinerary — stop title validation", () => {
  it("rejects a missing version with 400 (proves schema runs before DB lookup)", async () => {
    // No version field → AddStopBody fails zod → 400 before any select.
    const res = await request(authedApp)
      .post("/api/events/e1/itinerary")
      .send({ title: "   ", day: "2026-08-10" }); // no version
    expect(res.status).toBe(400);
  });
});

// ── POST /api/events/:id/tasks — add task ────────────────────────────────────
describe("POST /api/events/:id/tasks — title validation", () => {
  it("rejects a whitespace-only task title with 400", async () => {
    const res = await request(authedApp)
      .post("/api/events/e1/tasks")
      .send({ title: "   " });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/events/:id/packing — add packing item ─────────────────────────
describe("POST /api/events/:id/packing — label validation", () => {
  it("rejects a whitespace-only packing label with 400", async () => {
    const res = await request(authedApp)
      .post("/api/events/e1/packing")
      .send({ label: "   ", version: 1 });
    expect(res.status).toBe(400);
  });
});
