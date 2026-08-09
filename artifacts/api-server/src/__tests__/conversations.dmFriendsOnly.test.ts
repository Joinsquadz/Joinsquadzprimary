/**
 * DM authorization is FRIENDS-ONLY (replaces the earlier shared-squad rule).
 *
 * Rules verified here:
 *   - Not friends                      → 403 NOT_FRIENDS (even if they share a squad)
 *   - Friends                          → 201 (new or resumed thread)
 *   - Self-messaging                   → 400 (existing guard, unaffected)
 *   - Squad group chat                 → unaffected by friendship (see the
 *     squad-conversation tests; the friendship gate only runs for type "direct")
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Storage mock ──────────────────────────────────────────────────────────────
const storageMock = vi.hoisted(() => ({
  canInitiateDm: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  areUsersFriends: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  getOrCreateDirectConversation: vi.fn().mockResolvedValue({ id: "convo-1" }),
  getOrCreateSquadConversation: vi.fn().mockResolvedValue({ id: "squad-convo-1" }),
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
  storageMock.getOrCreateSquadConversation.mockResolvedValue({ id: "squad-convo-1" });
  storageMock.canInitiateDm.mockResolvedValue(true);
  storageMock.areUsersFriends.mockResolvedValue(true);
});

describe("POST /api/conversations/direct — friends-only DM gate", () => {
  it("returns 403 NOT_FRIENDS when the two users are not friends", async () => {
    storageMock.canInitiateDm.mockResolvedValue(false);

    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-2" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_FRIENDS");
    expect(res.body.error).toMatch(/friend/i);
    expect(storageMock.getOrCreateDirectConversation).not.toHaveBeenCalled();
  });

  it("still returns 403 for squadmates who are not friends (sharing a squad is not enough)", async () => {
    // canInitiateDm is friendship-only now, so a squadmate who never became a
    // friend is rejected exactly like a stranger.
    storageMock.canInitiateDm.mockResolvedValue(false);

    const res = await request(makeApp({ id: "squadmate-a" }))
      .post("/api/conversations/direct")
      .send({ userId: "squadmate-b" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_FRIENDS");
  });

  it("returns 201 when the two users are friends", async () => {
    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-2" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("convo-1");
  });

  it("still blocks self-messaging (existing guard)", async () => {
    const res = await request(makeApp({ id: "user-1" }))
      .post("/api/conversations/direct")
      .send({ userId: "user-1" });

    expect(res.status).toBe(400);
    expect(storageMock.canInitiateDm).not.toHaveBeenCalled();
  });

  it("calls canInitiateDm with the correct user pair", async () => {
    await request(makeApp({ id: "alice" }))
      .post("/api/conversations/direct")
      .send({ userId: "bob" });

    expect(storageMock.canInitiateDm).toHaveBeenCalledWith("alice", "bob");
  });
});

describe("GET /api/conversations/squad/:squadId — group chat ignores friendship", () => {
  it("opens the squad thread for a member who is friends with nobody in it", async () => {
    storageMock.areUsersFriends.mockResolvedValue(false);
    storageMock.canInitiateDm.mockResolvedValue(false);

    const res = await request(makeApp({ id: "member-1" })).get(
      "/api/conversations/squad/squad-1",
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-convo-1");
    // Membership is the only gate for group chat.
    expect(storageMock.getOrCreateSquadConversation).toHaveBeenCalledWith(
      "squad-1",
      "member-1",
    );
    expect(storageMock.canInitiateDm).not.toHaveBeenCalled();
  });

  it("still 403s a non-member (membership gate intact)", async () => {
    storageMock.getOrCreateSquadConversation.mockResolvedValue(null);

    const res = await request(makeApp({ id: "outsider" })).get(
      "/api/conversations/squad/squad-1",
    );

    expect(res.status).toBe(403);
  });
});
