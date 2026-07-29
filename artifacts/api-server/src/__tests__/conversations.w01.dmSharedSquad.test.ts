/**
 * W-01: POST /api/conversations/direct requires shared-squad history.
 *
 * Rules:
 *   - No existing DM + no shared history → 403 NO_SHARED_SQUAD
 *   - No existing DM + shared history    → 201 (new thread)
 *   - Existing DM thread present         → 201 (resumed; no history check needed)
 *   - Self-messaging                     → 400 (existing guard, unaffected)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Storage mock ──────────────────────────────────────────────────────────────
const storageMock = vi.hoisted(() => ({
  canInitiateDm: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  getOrCreateDirectConversation: vi.fn().mockResolvedValue({ id: "convo-1" }),
  listConversationsForUser: vi.fn().mockResolvedValue([]),
  getTotalUnreadCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications");
vi.mock("../lib/conversationUpdates", () => ({
  emitConversationUpdate: vi.fn(),
  onConversationUpdate: vi.fn((_id: string, _cb: unknown) => () => {}),
}));

import conversationsRouter from "../routes/conversations";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(conversationsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getOrCreateDirectConversation.mockResolvedValue({ id: "convo-1" });
  storageMock.canInitiateDm.mockResolvedValue(true);
});

describe("W-01: DM requires shared-squad history for new threads", () => {
  it("returns 403 with NO_SHARED_SQUAD when users have never shared a squad", async () => {
    storageMock.canInitiateDm.mockResolvedValue(false);

    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-2" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NO_SHARED_SQUAD");
    expect(res.body.error).toMatch(/squad/i);
    expect(storageMock.getOrCreateDirectConversation).not.toHaveBeenCalled();
  });

  it("returns 201 when users share a squad (canInitiateDm → true)", async () => {
    storageMock.canInitiateDm.mockResolvedValue(true);

    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-2" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("convo-1");
  });

  it("returns 201 when an existing DM thread exists (former squadmates or pre-fix thread)", async () => {
    // canInitiateDm returns true because the pre-existing directKey was found.
    storageMock.canInitiateDm.mockResolvedValue(true);
    storageMock.getOrCreateDirectConversation.mockResolvedValue({ id: "old-convo-7" });

    const res = await request(makeApp({ id: "alice" }))
      .post("/api/conversations/direct")
      .send({ userId: "bob" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("old-convo-7");
  });

  it("still blocks self-messaging (existing guard, unaffected by W-01)", async () => {
    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-1" }); // same userId

    expect(res.status).toBe(400);
    expect(storageMock.canInitiateDm).not.toHaveBeenCalled();
  });

  it("calls canInitiateDm with the correct user pair", async () => {
    storageMock.canInitiateDm.mockResolvedValue(true);

    await request(makeApp({ id: "alice" }))
      .post("/api/conversations/direct")
      .send({ userId: "bob" });

    expect(storageMock.canInitiateDm).toHaveBeenCalledWith("alice", "bob");
  });
});
