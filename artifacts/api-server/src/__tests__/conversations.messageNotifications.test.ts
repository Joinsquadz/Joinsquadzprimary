import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getConversationForMember: vi.fn(),
  addConversationMessage: vi.fn(),
  getConversationParticipants: vi.fn(),
  // DMs are friends-only; the notification cases are between friends, so the
  // live direct-thread gate reports no denial.
  areUsersFriends: vi.fn().mockResolvedValue(true),
  directThreadDenialReason: vi.fn().mockResolvedValue(null),
  getPushTokensForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
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
  storageMock.directThreadDenialReason.mockResolvedValue(null);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getUser.mockResolvedValue({ id: SENDER, firstName: "Sam", lastName: null, email: "sam@x.io" });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
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
    storageMock.directThreadDenialReason.mockResolvedValue(null);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = await makeApp({ id: SENDER });
    await request(app).post("/api/conversations/c1/messages").send({ text: "hi" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("uses a photo/video preview body for attachment-only messages (squad thread, not gated)", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c2", type: "squad", squadId: "squad-9" });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: SENDER });
    await request(app)
      .post("/api/conversations/c2/messages")
      .send({ text: "", attachments: [{ kind: "image", url: "https://x/y.jpg" }] });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("Photo");
  });

  it("sends the full DM body to every recipient regardless of plan (DM gate removed)", async () => {
    storageMock.getConversationForMember.mockResolvedValue({ id: "c1", type: "direct", squadId: null });
    // ALICE is Pro (active subscription); BOB is free — both must get the full body.
    storageMock.getUser.mockImplementation(async (uid: string) => {
      if (uid === ALICE) return { id: ALICE, firstName: "Alice", lastName: null, email: "a@x.io", stripeSubscriptionId: "sub_alice" };
      if (uid === BOB) return { id: BOB, firstName: "Bob", lastName: null, email: "b@x.io" };
      return { id: SENDER, firstName: "Sam", lastName: null, email: "sam@x.io" };
    });
    storageMock.getSubscription.mockImplementation(async (subId: string) =>
      subId === "sub_alice" ? { status: "active" } : null,
    );
    // Token lookup returns a per-recipient token so we can inspect the batch.
    storageMock.getPushTokensForUsers.mockImplementation(async (ids: string[]) => ids.map((id) => `tok-${id}`));

    const app = await makeApp({ id: SENDER });
    await request(app)
      .post("/api/conversations/c1/messages")
      .send({ text: "secret plans tonight" });

    // No per-plan batching anymore — everyone is notified in a single send.
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1));

    const [tokens, payload] = sendPushNotificationsMock.mock.calls[0] as [string[], { title: string; body: string }];
    // Both the Pro and the free recipient are in the same batch.
    expect(tokens).toContain(`tok-${ALICE}`);
    expect(tokens).toContain(`tok-${BOB}`);
    // The full message content is delivered to all recipients (no redaction).
    expect(payload.body).toBe("secret plans tonight");
    expect(payload.title).toBe("Sam");
  });
});
