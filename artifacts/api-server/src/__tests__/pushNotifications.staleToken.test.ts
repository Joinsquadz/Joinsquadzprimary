import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendPushNotificationsAsync = vi.hoisted(() => vi.fn());
const mockChunkPushNotifications = vi.hoisted(() =>
  vi.fn((msgs: unknown[]) => [msgs]),
);
const mockIsExpoPushToken = vi.hoisted(() => vi.fn(() => true));

vi.mock("expo-server-sdk", () => {
  function ExpoMock(this: object) {
    Object.assign(this, {
      chunkPushNotifications: mockChunkPushNotifications,
      sendPushNotificationsAsync: mockSendPushNotificationsAsync,
    });
  }
  ExpoMock.isExpoPushToken = mockIsExpoPushToken;
  return { Expo: ExpoMock };
});

vi.mock("../lib/logger");

const mockStorePushTicket = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDeletePushTickets = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLoadAllPushTickets = vi.hoisted(() => vi.fn().mockResolvedValue(new Map()));

vi.mock("../storage", () => ({
  storage: {
    storePushTicket: mockStorePushTicket,
    storePushTicketsBatch: vi.fn().mockResolvedValue(undefined),
    deletePushTickets: mockDeletePushTickets,
    loadAllPushTickets: mockLoadAllPushTickets,
  },
}));

import { sendPushNotifications } from "../lib/pushNotifications";

const TOKEN_A = "ExponentPushToken[token-a]";
const TOKEN_B = "ExponentPushToken[token-b]";
const TOKEN_C = "ExponentPushToken[token-c]";

const PAYLOAD = { title: "Test", body: "Hello" };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsExpoPushToken.mockReturnValue(true);
  mockChunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs]);
});

describe("sendPushNotifications — stale token cleanup", () => {
  it("sends one Expo message per unique device token", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-a" },
      { status: "ok", id: "ticket-b" },
    ]);

    await sendPushNotifications([TOKEN_A, TOKEN_A, TOKEN_B, TOKEN_A], PAYLOAD);

    const messages = mockChunkPushNotifications.mock.calls[0][0] as Array<{ to: string }>;
    expect(messages.map((message) => message.to)).toEqual([TOKEN_A, TOKEN_B]);
  });

  it("reports non-stale ticket errors as retryable failedTokens", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-a" },
      { status: "error", details: { error: "MessageRateExceeded" } },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const result = await sendPushNotifications([TOKEN_A, TOKEN_B, TOKEN_C], PAYLOAD);

    // B is retryable; C is gone for good and must not be retried.
    expect(result.failedTokens).toEqual([TOKEN_B]);
    expect(result.staleTokens).toEqual([TOKEN_C]);
  });

  it("treats every device in a chunk that never submitted as still owed the push", async () => {
    mockSendPushNotificationsAsync.mockRejectedValue(new Error("network down"));

    const result = await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD);

    expect(result.failedTokens).toEqual([TOKEN_A, TOKEN_B]);
    expect(result.okCount).toBe(0);
  });

  it("returns stale tokens when DeviceNotRegistered error is in the ticket", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const result = await sendPushNotifications([TOKEN_A], PAYLOAD);

    expect(result.staleTokens).toEqual([TOKEN_A]);
  });

  it("calls onStaleToken for each DeviceNotRegistered ticket", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD, { onStaleToken });

    expect(onStaleToken).toHaveBeenCalledTimes(2);
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_A);
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_B);
  });

  it("does NOT call onStaleToken for non-DeviceNotRegistered errors", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "MessageTooBig" } },
    ]);

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    await sendPushNotifications([TOKEN_A], PAYLOAD, { onStaleToken });

    expect(onStaleToken).not.toHaveBeenCalled();
    expect((await sendPushNotifications([TOKEN_A], PAYLOAD)).staleTokens).toEqual([]);
  });

  it("does NOT call onStaleToken for successful tickets", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-id" },
    ]);

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    await sendPushNotifications([TOKEN_A], PAYLOAD, { onStaleToken });

    expect(onStaleToken).not.toHaveBeenCalled();
  });

  it("only marks DeviceNotRegistered tokens stale when mixed with ok tickets", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "ticket-3" },
    ]);

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    const result = await sendPushNotifications(
      [TOKEN_A, TOKEN_B, TOKEN_C],
      PAYLOAD,
      { onStaleToken },
    );

    expect(result.staleTokens).toEqual([TOKEN_B]);
    expect(onStaleToken).toHaveBeenCalledTimes(1);
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_B);
  });

  it("does not throw and completes normally when onStaleToken rejects", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const onStaleToken = vi.fn().mockRejectedValue(new Error("DB error"));
    await expect(
      sendPushNotifications([TOKEN_A], PAYLOAD, { onStaleToken }),
    ).resolves.not.toThrow();
  });

  it("returns stale token even when onStaleToken rejects", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const onStaleToken = vi.fn().mockRejectedValue(new Error("DB error"));
    const result = await sendPushNotifications([TOKEN_A], PAYLOAD, { onStaleToken });

    expect(result.staleTokens).toEqual([TOKEN_A]);
  });

  it("returns empty staleTokens when no tokens are given", async () => {
    const result = await sendPushNotifications([], PAYLOAD);
    expect(result.staleTokens).toEqual([]);
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it("skips tokens that fail Expo.isExpoPushToken validation", async () => {
    mockIsExpoPushToken.mockReturnValue(false);

    const result = await sendPushNotifications([TOKEN_A], PAYLOAD);

    expect(result.staleTokens).toEqual([]);
    expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it("does not throw when the entire send call rejects", async () => {
    mockSendPushNotificationsAsync.mockRejectedValue(new Error("Network error"));

    await expect(sendPushNotifications([TOKEN_A], PAYLOAD)).resolves.not.toThrow();
  });

  it("works without onStaleToken option and still returns stale tokens", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    const result = await sendPushNotifications([TOKEN_A], PAYLOAD);
    expect(result.staleTokens).toEqual([TOKEN_A]);
  });
});
