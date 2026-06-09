import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  addConversationMessage: vi.fn(),
  getConversationParticipants: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getUser: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: sendPushNotificationsMock,
}));

import conversationsRouter from "../routes/conversations";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(conversationsRouter, user);

const SENDER = "sender-id";
const ALICE = "alice-id";
const BOB = "bob-id";

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.addConversationMessage.mockResolvedValue({ id: "msg-1", text: "hi" });
  storageMock.getConversationParticipants.mockResolvedValue([
    { userId: SENDER },
    { userId: ALICE },
    { userId: BOB },
  ]);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getUser.mockResolvedValue({ id: SENDER, firstName: "Sam", lastName: null, email: "sam@x.io" });
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/conversations/:id/messages — push notifications", () => {
  it("notifies the other participants (not the sender) with the Messages pref required", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c1", type: "direct", squadId: null });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: SENDER });
    await request(app).post("/api/conversations/c1/messages").send({ text: "hi" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());

    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyMessages?: boolean }];
    expect(recipientIds).toContain(ALICE);
    expect(recipientIds).toContain(BOB);
    expect(recipientIds).not.toContain(SENDER);
    expect(opts.requireNotifyMessages).toBe(true);

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { title: string; data: Record<string, string> }];
    expect(payload.title).toBe("Sam");
    expect(payload.data.screen).toBe("conversation");
    expect(payload.data.conversationId).toBe("c1");
  });

  it("applies the squad mute filter for squad conversations", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c2", type: "squad", squadId: "squad-9" });
    storageMock.filterUnmutedForSquad.mockResolvedValue([ALICE]);
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: SENDER });
    await request(app).post("/api/conversations/c2/messages").send({ text: "yo" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());

    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith(
      expect.arrayContaining([ALICE, BOB]),
      "squad-9",
    );
    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], unknown];
    expect(recipientIds).toEqual([ALICE]);
  });

  it("does NOT send when no recipient has a registered token (or all muted the pref)", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c1", type: "direct", squadId: null });
    storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = await makeApp({ id: SENDER });
    await request(app).post("/api/conversations/c1/messages").send({ text: "hi" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("uses a photo/video preview body for attachment-only messages", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c1", type: "direct", squadId: null });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: SENDER });
    await request(app)
      .post("/api/conversations/c1/messages")
      .send({ text: "", attachments: [{ kind: "image", url: "https://x/y.jpg" }] });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("Photo");
  });
});
