import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const state = vi.hoisted(() => ({
  member: null as { id: string; type: string; squadId: string | null } | null,
  messages: [] as unknown[],
  participants: [] as unknown[],
}));

vi.mock("../storage", () => ({
  storage: {
    listConversationsForUser: () => Promise.resolve([]),
    getTotalUnreadCount: () => Promise.resolve(0),
    getOrCreateDirectConversation: (a: string, b: string) =>
      Promise.resolve({ id: `direct-${[a, b].sort().join("-")}` }),
    getOrCreateSquadConversation: (squadId: string, _userId: string) =>
      state.member ? Promise.resolve({ id: `squad-${squadId}` }) : Promise.resolve(null),
    getConversationForMember: () => Promise.resolve(state.member),
    getConversationMessages: () => Promise.resolve(state.messages),
    getConversationParticipants: () => Promise.resolve(state.participants),
    addConversationMessage: (id: string, senderId: string, text: string) =>
      Promise.resolve({ id: "msg-1", conversationId: id, senderId, text }),
    markConversationRead: () => Promise.resolve(),
  },
}));

vi.mock("../lib/logger");

import conversationsRouter from "../routes/conversations";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(conversationsRouter, user);

const ME = "me-id";
const FRIEND = "friend-id";

beforeEach(() => {
  state.member = null;
  state.messages = [];
  state.participants = [];
});

describe("GET /api/conversations", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp()).get("/api/conversations");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a list when authenticated", async () => {
    const res = await request(await makeApp({ id: ME })).get("/api/conversations");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /api/conversations/unread-count", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp()).get("/api/conversations/unread-count");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a count when authenticated", async () => {
    const res = await request(await makeApp({ id: ME })).get("/api/conversations/unread-count");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe("POST /api/conversations/direct", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp())
      .post("/api/conversations/direct")
      .send({ userId: FRIEND });
    expect(res.status).toBe(401);
  });

  it("returns 400 when starting a conversation with yourself", async () => {
    const res = await request(await makeApp({ id: ME }))
      .post("/api/conversations/direct")
      .send({ userId: ME });
    expect(res.status).toBe(400);
  });

  it("returns 201 with the conversation id", async () => {
    const res = await request(await makeApp({ id: ME }))
      .post("/api/conversations/direct")
      .send({ userId: FRIEND });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
  });
});

describe("GET /api/conversations/squad/:squadId", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp()).get("/api/conversations/squad/squad-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a squad member", async () => {
    state.member = null;
    const res = await request(await makeApp({ id: "stranger" })).get(
      "/api/conversations/squad/squad-1",
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 with the conversation id when a member", async () => {
    state.member = { id: "squad-squad-1", type: "squad", squadId: "squad-1" };
    const res = await request(await makeApp({ id: ME })).get("/api/conversations/squad/squad-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-squad-1");
  });
});

describe("GET /api/conversations/:id/messages", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp()).get("/api/conversations/c1/messages");
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a participant", async () => {
    state.member = null;
    const res = await request(await makeApp({ id: "stranger" })).get(
      "/api/conversations/c1/messages",
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 with messages when a participant", async () => {
    state.member = { id: "c1", type: "direct", squadId: null };
    state.messages = [{ id: "m1", text: "hi" }];
    const res = await request(await makeApp({ id: ME })).get("/api/conversations/c1/messages");
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });
});

describe("POST /api/conversations/:id/messages", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp())
      .post("/api/conversations/c1/messages")
      .send({ text: "hi" });
    expect(res.status).toBe(401);
  });

  it("returns 400 with neither text nor attachments", async () => {
    state.member = { id: "c1", type: "direct", squadId: null };
    const res = await request(await makeApp({ id: ME }))
      .post("/api/conversations/c1/messages")
      .send({ text: "   ", attachments: [] });
    expect(res.status).toBe(400);
  });

  it("returns 403 when not a participant", async () => {
    state.member = null;
    const res = await request(await makeApp({ id: "stranger" }))
      .post("/api/conversations/c1/messages")
      .send({ text: "hi" });
    expect(res.status).toBe(403);
  });

  it("returns 201 when a participant sends text", async () => {
    state.member = { id: "c1", type: "direct", squadId: null };
    const res = await request(await makeApp({ id: ME }))
      .post("/api/conversations/c1/messages")
      .send({ text: "hi" });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("msg-1");
  });
});

describe("POST /api/conversations/:id/read", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(await makeApp()).post("/api/conversations/c1/read");
    expect(res.status).toBe(401);
  });

  it("returns 403 when not a participant", async () => {
    state.member = null;
    const res = await request(await makeApp({ id: "stranger" })).post(
      "/api/conversations/c1/read",
    );
    expect(res.status).toBe(403);
  });

  it("returns 200 when a participant", async () => {
    state.member = { id: "c1", type: "direct", squadId: null };
    const res = await request(await makeApp({ id: ME })).post("/api/conversations/c1/read");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
