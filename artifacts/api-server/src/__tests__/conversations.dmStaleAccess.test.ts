/**
 * Every DM surface — not just read and send — has to honour the live
 * friends-only/block gate.
 *
 * The SSE stream and the read-receipt endpoint used to authorize on participant
 * membership alone, which left an unfriended or blocked person with a live
 * subscription to a thread they can no longer open, and the ability to keep
 * writing read state onto it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import http from "node:http";

const storageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  getConversationMessages: vi.fn().mockResolvedValue({ messages: [], hasMore: false }),
  getConversationParticipants: vi.fn().mockResolvedValue([]),
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  directThreadDenialReason: vi.fn<() => Promise<"blocked" | "not_friends" | null>>(),
  listConversationsForUser: vi.fn().mockResolvedValue([]),
  getTotalUnreadCount: vi.fn().mockResolvedValue(0),
  areUsersFriends: vi.fn().mockResolvedValue(true),
}));

// Captures the update callback the route registers so a test can emit a push
// after the relationship changes.
const listeners = vi.hoisted(() => ({ fns: [] as Array<() => void> }));
const unsubscribeMock = vi.hoisted(() => vi.fn());
const onConversationUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/conversationUpdates", () => ({
  emitConversationUpdate: vi.fn(),
  onConversationUpdate: onConversationUpdateMock,
}));

import conversationsRouter from "../routes/conversations";
import { makeTestApp } from "./helpers/makeTestApp";

const ME = "me-1";
const CONVO = "convo-direct-1";
const SQUAD_CONVO = "convo-squad-1";
const app = makeTestApp(conversationsRouter, { id: ME });

/**
 * An accepted SSE response never ends, so supertest would hang waiting for it.
 * Open a real socket, read the status line, then hang up.
 */
function openStream(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address() as { port: number };
      const req = http.get({ port, path }, (res) => {
        const status = res.statusCode ?? 0;
        res.destroy();
        req.destroy();
        server.close(() => resolve(status));
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.fns = [];
  onConversationUpdateMock.mockImplementation((_id: string, cb: () => void) => {
    listeners.fns.push(cb);
    return unsubscribeMock;
  });
  storageMock.getConversationForMember.mockResolvedValue({
    id: CONVO,
    type: "direct",
    squadId: null,
  });
  storageMock.getConversationMessages.mockResolvedValue({ messages: [], hasMore: false });
  storageMock.getConversationParticipants.mockResolvedValue([]);
  storageMock.directThreadDenialReason.mockResolvedValue(null);
});

describe("GET /api/conversations/:id/stream — live gate on the SSE subscription", () => {
  it("refuses to open the stream for a former friend", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("not_friends");

    const res = await request(app).get(`/api/conversations/${CONVO}/stream`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_FRIENDS");
    expect(onConversationUpdateMock).not.toHaveBeenCalled();
  });

  it("refuses to open the stream for a blocked participant, with neutral copy", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");

    const res = await request(app).get(`/api/conversations/${CONVO}/stream`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("You can't message this person");
    expect(res.body.code).toBeUndefined();
    expect(onConversationUpdateMock).not.toHaveBeenCalled();
  });

  it("opens the stream while the thread is still open", async () => {
    const status = await openStream(`/api/conversations/${CONVO}/stream`);

    expect(status).toBe(200);
    expect(onConversationUpdateMock).toHaveBeenCalled();
  });

  it("does not apply the friendship gate to a squad chat stream", async () => {
    storageMock.getConversationForMember.mockResolvedValue({
      id: SQUAD_CONVO,
      type: "squad",
      squadId: "squad-1",
    });
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");

    const status = await openStream(`/api/conversations/${SQUAD_CONVO}/stream`);

    expect(status).toBe(200);
    expect(storageMock.directThreadDenialReason).not.toHaveBeenCalled();
  });
});

describe("POST /api/conversations/:id/read — live gate on read receipts", () => {
  it("refuses to mark a closed DM read after an unfriend", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("not_friends");

    const res = await request(app).post(`/api/conversations/${CONVO}/read`);

    expect(res.status).toBe(403);
    expect(storageMock.markConversationRead).not.toHaveBeenCalled();
  });

  it("refuses to mark a DM read after a block", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("blocked");

    const res = await request(app).post(`/api/conversations/${CONVO}/read`);

    expect(res.status).toBe(403);
    expect(storageMock.markConversationRead).not.toHaveBeenCalled();
  });

  it("marks an open DM read", async () => {
    const res = await request(app).post(`/api/conversations/${CONVO}/read`);

    expect(res.status).toBe(200);
    expect(storageMock.markConversationRead).toHaveBeenCalledWith(CONVO, ME);
  });

  it("still marks a squad chat read regardless of friendship", async () => {
    storageMock.getConversationForMember.mockResolvedValue({
      id: SQUAD_CONVO,
      type: "squad",
      squadId: "squad-1",
    });
    storageMock.directThreadDenialReason.mockResolvedValue("not_friends");

    const res = await request(app).post(`/api/conversations/${SQUAD_CONVO}/read`);

    expect(res.status).toBe(200);
    expect(storageMock.markConversationRead).toHaveBeenCalledWith(SQUAD_CONVO, ME);
  });
});

describe("GET /api/conversations/:id/messages — stale participant row is not access", () => {
  it("refuses to return a closed DM's history to a former friend", async () => {
    storageMock.directThreadDenialReason.mockResolvedValue("not_friends");

    const res = await request(app).get(`/api/conversations/${CONVO}/messages`);

    expect(res.status).toBe(403);
    expect(storageMock.getConversationMessages).not.toHaveBeenCalled();
  });
});

/**
 * Opens a stream and keeps the socket alive so the test can inspect what the
 * server pushes (and whether it hangs up).
 */
function liveStream(path: string): Promise<{
  body: () => string;
  ended: () => boolean;
  waitForQuiet: () => Promise<void>;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address() as { port: number };
      const req = http.get({ port, path }, (res) => {
        let body = "";
        let ended = false;
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          ended = true;
        });
        resolve({
          body: () => body,
          ended: () => ended,
          // Let the server's async re-authorization and any socket writes land.
          waitForQuiet: () =>
            new Promise<void>((r) => {
              setTimeout(r, 50);
            }),
          close: () =>
            new Promise<void>((r) => {
              req.destroy();
              server.close(() => r());
            }),
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

describe("GET /api/conversations/:id/stream — revocation while the stream is open", () => {
  it("stops delivering updates and closes the socket once the pair are no longer friends", async () => {
    const stream = await liveStream(`/api/conversations/${CONVO}/stream`);
    await stream.waitForQuiet();
    expect(stream.body()).toContain("event: connected");
    expect(listeners.fns).toHaveLength(1);

    // Unfriended after the socket was already open.
    storageMock.directThreadDenialReason.mockResolvedValue("not_friends");
    listeners.fns[0]();
    await stream.waitForQuiet();

    // Not even the bare "something happened" ping is delivered.
    expect(stream.body()).not.toContain("event: update");
    expect(stream.ended()).toBe(true);
    expect(unsubscribeMock).toHaveBeenCalled();

    await stream.close();
  });

  it("stops delivering updates and closes the socket once one side blocks the other", async () => {
    const stream = await liveStream(`/api/conversations/${CONVO}/stream`);
    await stream.waitForQuiet();

    storageMock.directThreadDenialReason.mockResolvedValue("blocked");
    listeners.fns[0]();
    await stream.waitForQuiet();

    expect(stream.body()).not.toContain("event: update");
    expect(stream.ended()).toBe(true);

    await stream.close();
  });

  it("keeps delivering updates while the thread stays open", async () => {
    const stream = await liveStream(`/api/conversations/${CONVO}/stream`);
    await stream.waitForQuiet();

    listeners.fns[0]();
    await stream.waitForQuiet();

    expect(stream.body()).toContain("event: update");
    expect(stream.ended()).toBe(false);

    await stream.close();
  });

  it("fails closed when the gate itself errors mid-stream", async () => {
    const stream = await liveStream(`/api/conversations/${CONVO}/stream`);
    await stream.waitForQuiet();

    storageMock.directThreadDenialReason.mockRejectedValue(new Error("db down"));
    listeners.fns[0]();
    await stream.waitForQuiet();

    expect(stream.body()).not.toContain("event: update");
    expect(stream.ended()).toBe(true);

    await stream.close();
  });

  it("does not re-check friendship for squad chat updates", async () => {
    storageMock.getConversationForMember.mockResolvedValue({
      id: SQUAD_CONVO,
      type: "squad",
      squadId: "squad-1",
    });
    const stream = await liveStream(`/api/conversations/${SQUAD_CONVO}/stream`);
    await stream.waitForQuiet();

    listeners.fns[0]();
    await stream.waitForQuiet();

    expect(stream.body()).toContain("event: update");
    expect(storageMock.directThreadDenialReason).not.toHaveBeenCalled();

    await stream.close();
  });
});
