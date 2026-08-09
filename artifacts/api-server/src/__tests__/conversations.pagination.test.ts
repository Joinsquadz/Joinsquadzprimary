// B1 — DM / squad-chat pagination: GET /conversations/:id/messages
//   - Returns hasMore+nextCursor when older messages exist.
//   - Passes the ?before cursor to storage on load-more requests.
//   - nextCursor is the id of the OLDEST message in the returned page
//     (so the next ?before fetch fetches the page before it).
//   - When hasMore is false, nextCursor is null.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  getConversationMessages: vi.fn(),
  getConversationParticipants: vi.fn(),
  // DMs are friends-only; these pagination cases are between friends, so the
  // live direct-thread gate reports no denial.
  areUsersFriends: vi.fn().mockResolvedValue(true),
  directThreadDenialReason: vi.fn().mockResolvedValue(null),
}));

vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));

vi.mock("../storage", () => ({
  storage: {
    ...storageMock,
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  conversationsTable: {},
}));

vi.mock("../lib/logger");

import conversationsRouter from "../routes/conversations";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_ID = "user-a";
const CONVO_ID = "convo-1";

const makeApp = () => makeTestApp(conversationsRouter, { id: USER_ID });

const CONVO = { id: CONVO_ID, type: "direct", squadId: null };
const PARTICIPANTS = [
  { userId: USER_ID },
  { userId: "user-b" },
];

function makeMessages(count: number, startId = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${startId + i}`,
    senderId: USER_ID,
    text: `Message ${startId + i}`,
    createdAt: new Date(Date.now() - (count - i) * 1000).toISOString(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getConversationForMember.mockResolvedValue(CONVO);
  storageMock.getConversationParticipants.mockResolvedValue(PARTICIPANTS);
  storageMock.directThreadDenialReason.mockResolvedValue(null);
});

describe("B1 — GET /api/conversations/:id/messages — cursor pagination", () => {
  it("returns hasMore:false and nextCursor:null on the last page", async () => {
    const messages = makeMessages(5, 1);
    storageMock.getConversationMessages.mockResolvedValue({ messages, hasMore: false });
    const res = await request(makeApp()).get(`/api/conversations/${CONVO_ID}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.messages).toHaveLength(5);
  });

  it("returns hasMore:true and nextCursor = oldest message id when more pages exist", async () => {
    const messages = makeMessages(20, 1);
    storageMock.getConversationMessages.mockResolvedValue({ messages, hasMore: true });
    const res = await request(makeApp()).get(`/api/conversations/${CONVO_ID}/messages`);
    expect(res.status).toBe(200);
    expect(res.body.hasMore).toBe(true);
    // nextCursor must be the first element (oldest message in the page, used as
    // the cursor for the next load-older request).
    expect(res.body.nextCursor).toBe(messages[0].id);
  });

  it("forwards the ?before cursor to storage.getConversationMessages", async () => {
    const messages = makeMessages(10, 1);
    storageMock.getConversationMessages.mockResolvedValue({ messages, hasMore: false });
    const res = await request(makeApp())
      .get(`/api/conversations/${CONVO_ID}/messages?before=msg-50`);
    expect(res.status).toBe(200);
    const [, opts] = storageMock.getConversationMessages.mock.calls[0] as [
      string,
      { before?: string; limit?: number },
    ];
    expect(opts.before).toBe("msg-50");
  });

  it("forwards a custom ?limit to storage", async () => {
    storageMock.getConversationMessages.mockResolvedValue({ messages: makeMessages(5), hasMore: false });
    await request(makeApp()).get(`/api/conversations/${CONVO_ID}/messages?limit=5`);
    const [, opts] = storageMock.getConversationMessages.mock.calls[0] as [
      string,
      { limit?: number },
    ];
    expect(opts.limit).toBe(5);
  });

  it("returns 403 when the user is not a participant", async () => {
    storageMock.getConversationForMember.mockResolvedValue(null);
    const res = await request(makeApp()).get(`/api/conversations/${CONVO_ID}/messages`);
    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeTestApp(conversationsRouter))
      .get(`/api/conversations/${CONVO_ID}/messages`);
    expect(res.status).toBe(401);
  });

  it("page 2 response has nextCursor = oldest message on that older page", async () => {
    const olderMessages = makeMessages(10, 41);
    storageMock.getConversationMessages.mockResolvedValue({
      messages: olderMessages,
      hasMore: true,
    });
    const res = await request(makeApp())
      .get(`/api/conversations/${CONVO_ID}/messages?before=msg-51`);
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBe("msg-41"); // oldest in this page
    expect(res.body.hasMore).toBe(true);
  });
});
