// B2 — blocked DM: both parties (blocker AND blockee) receive 403 when one has
// blocked the other. The response body never reveals who blocked whom — the copy
// is symmetric: "You can't message this person".
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationParticipants: vi.fn(),
  addConversationMessage: vi.fn(),
  getOrCreateDirectConversation: vi.fn(),
  // Friendship is a separate gate from blocking — default to friends so these
  // cases isolate the block behavior.
  areUsersFriends: vi.fn().mockResolvedValue(true),
  // The live direct-thread gate now lives in storage (it consults blocks in
  // BOTH directions and current friendship — see
  // storage.directThreadAccess.test.ts). These route tests assert that every
  // DM surface consults it and maps the reason to the right response.
  directThreadDenialReason: vi.fn<() => Promise<"blocked" | "not_friends" | null>>(),
  // For listConversationsForUser — not needed in these tests.
}));

const getBlockedMock = vi.hoisted(() => vi.fn<() => Promise<string[]>>());

vi.mock("../storage", () => ({ storage: { ...storageMock } }));
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: getBlockedMock,
}));
vi.mock("@workspace/db", () => ({ db: {}, conversationsTable: {} }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/conversationUpdates", () => ({
  emitConversationUpdate: vi.fn(),
  onConversationUpdate: vi.fn().mockReturnValue(() => {}),
}));

import conversationsRouter from "../routes/conversations";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_A = "user-a";
const USER_B = "user-b";
const CONVO_ID = "convo-1";

const directConvo = {
  id: CONVO_ID,
  type: "direct" as const,
  squadId: null,
  otherUserId: USER_B,
};

function makeApp(userId: string) {
  return makeTestApp(conversationsRouter, { id: userId });
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getConversationForMember.mockResolvedValue(directConvo);
  storageMock.getConversationParticipants.mockResolvedValue([
    { userId: USER_A },
    { userId: USER_B },
  ]);
  storageMock.addConversationMessage.mockResolvedValue({
    id: "msg-1",
    conversationId: CONVO_ID,
    senderId: USER_A,
    text: "Hello",
    createdAt: new Date().toISOString(),
  });
  getBlockedMock.mockResolvedValue([]);
  storageMock.directThreadDenialReason.mockResolvedValue(null);
});

describe("B2 — POST /api/conversations/:id/messages blocked in both directions", () => {
  it("returns 403 when the SENDER has blocked the OTHER party", async () => {
    // USER_A blocked USER_B.
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    const res = await request(makeApp(USER_A))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "Hello" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can't message this person");
  });

  it("returns 403 when the RECEIVER has blocked the sender (reverse direction)", async () => {
    // USER_B blocked USER_A — the gate reports "blocked" for either direction.
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    const res = await request(makeApp(USER_A))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "Hey!" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can't message this person");
  });

  it("returns 201 when there is no block relationship", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue(null);
    const res = await request(makeApp(USER_A))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "Hey!" });
    expect(res.status).toBe(201);
  });

  it("error copy never reveals who blocked whom (symmetric message)", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    // Sender's perspective.
    const fromA = await request(makeApp(USER_A))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "A→B" });
    expect(fromA.body.error).toBe("You can't message this person");

    // Now test from B's perspective (simulating B blocked by A or vice versa).
    storageMock.getConversationParticipants.mockResolvedValue([
      { userId: USER_B },
      { userId: USER_A },
    ]);
    storageMock.getConversationForMember.mockResolvedValue({
      ...directConvo,
      otherUserId: USER_A,
    });
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    const fromB = await request(makeApp(USER_B))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "B→A" });
    expect(fromB.body.error).toBe("You can't message this person");
    // Same copy both ways — no directional "you blocked" / "you are blocked".
    expect(fromA.body.error).toBe(fromB.body.error);
  });

  it("block check only applies to direct conversations, not squad chats", async () => {
    // Squad conversation: even if getBlockedAndBlockerIds returns something, the
    // block check is skipped because type !== 'direct'.
    storageMock.getConversationForMember.mockResolvedValue({
      id: CONVO_ID,
      type: "squad",
      squadId: "squad-1",
    });
    storageMock.getConversationParticipants.mockResolvedValue([
      { userId: USER_A },
      { userId: USER_B },
    ]);
    // Even if there's a block, squad sends go through — the gate must not even
    // be consulted for a squad conversation.
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    const res = await request(makeApp(USER_A))
      .post(`/api/conversations/${CONVO_ID}/messages`)
      .send({ text: "Squad message" });
    expect(res.status).toBe(201);
    expect(storageMock.directThreadDenialReason).not.toHaveBeenCalled();
  });
});

describe("B2 — POST /api/conversations/direct creation is blocked", () => {
  it("returns 403 when creating a DM with a blocked user", async () => {
    storageMock.getOrCreateDirectConversation = vi
      .fn()
      .mockResolvedValue({ id: "new-convo" });
    getBlockedMock.mockResolvedValue([USER_B]);
    const res = await request(makeApp(USER_A))
      .post("/api/conversations/direct")
      .send({ userId: USER_B });
    expect(res.status).toBe(403);
  });
});
