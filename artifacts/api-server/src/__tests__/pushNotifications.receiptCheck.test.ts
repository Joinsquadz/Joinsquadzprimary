import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPushNotificationReceiptsAsync = vi.hoisted(() => vi.fn());
const mockChunkPushReceiptIds = vi.hoisted(() =>
  vi.fn((ids: string[]) => [ids]),
);
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
      chunkPushReceiptIds: mockChunkPushReceiptIds,
      getPushNotificationReceiptsAsync: mockGetPushNotificationReceiptsAsync,
    });
  }
  ExpoMock.isExpoPushToken = mockIsExpoPushToken;
  return { Expo: ExpoMock };
});

vi.mock("../lib/logger");

import {
  sendPushNotifications,
  checkPushReceipts,
  _pendingTickets,
} from "../lib/pushNotifications";

const TOKEN_A = "ExponentPushToken[token-a]";
const TOKEN_B = "ExponentPushToken[token-b]";
const PAYLOAD = { title: "Test", body: "Hello" };

beforeEach(() => {
  vi.clearAllMocks();
  _pendingTickets.clear();
  mockIsExpoPushToken.mockReturnValue(true);
  mockChunkPushNotifications.mockImplementation((msgs: unknown[]) => [msgs]);
  mockChunkPushReceiptIds.mockImplementation((ids: string[]) => [ids]);
});

describe("sendPushNotifications — ticket ID tracking", () => {
  it("stores successful ticket IDs mapped to their token", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);

    expect(_pendingTickets.get("ticket-1")).toBe(TOKEN_A);
  });

  it("stores multiple successful ticket IDs", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
      { status: "ok", id: "ticket-2" },
    ]);

    await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD);

    expect(_pendingTickets.get("ticket-1")).toBe(TOKEN_A);
    expect(_pendingTickets.get("ticket-2")).toBe(TOKEN_B);
  });

  it("does NOT store ticket IDs for DeviceNotRegistered errors", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);

    expect(_pendingTickets.size).toBe(0);
  });

  it("does NOT store ticket IDs for other ticket errors", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "MessageTooBig" } },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);

    expect(_pendingTickets.size).toBe(0);
  });

  it("only stores ok tickets when mixed with errors", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD);

    expect(_pendingTickets.get("ticket-1")).toBe(TOKEN_A);
    expect(_pendingTickets.size).toBe(1);
  });
});

describe("checkPushReceipts — stale token cleanup", () => {
  it("returns empty staleTokens and skips Expo when no tickets are pending", async () => {
    const result = await checkPushReceipts();

    expect(result.staleTokens).toEqual([]);
    expect(mockGetPushNotificationReceiptsAsync).not.toHaveBeenCalled();
  });

  it("calls onStaleToken for DeviceNotRegistered receipts and returns stale tokens", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([TOKEN_A]);
    expect(onStaleToken).toHaveBeenCalledOnce();
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_A);
  });

  it("clears the ticket from pending after processing", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    await checkPushReceipts();

    expect(_pendingTickets.size).toBe(0);
  });

  it("does NOT call onStaleToken for successful receipts", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    const onStaleToken = vi.fn();
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([]);
    expect(onStaleToken).not.toHaveBeenCalled();
  });

  it("does NOT call onStaleToken for non-DeviceNotRegistered errors", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", details: { error: "InvalidCredentials" } },
    });

    const onStaleToken = vi.fn();
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([]);
    expect(onStaleToken).not.toHaveBeenCalled();
  });

  it("handles multiple tickets, only marking DeviceNotRegistered ones stale", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    _pendingTickets.set("ticket-2", TOKEN_B);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
      "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([TOKEN_B]);
    expect(onStaleToken).toHaveBeenCalledOnce();
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_B);
    expect(_pendingTickets.size).toBe(0);
  });

  it("does not throw and still processes other tickets when onStaleToken rejects", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    _pendingTickets.set("ticket-2", TOKEN_B);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } },
      "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    const onStaleToken = vi.fn().mockRejectedValue(new Error("DB error"));
    await expect(checkPushReceipts({ onStaleToken })).resolves.not.toThrow();
    expect(onStaleToken).toHaveBeenCalledTimes(2);
  });

  it("still returns stale tokens even when onStaleToken rejects", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    const onStaleToken = vi.fn().mockRejectedValue(new Error("DB error"));
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([TOKEN_A]);
  });

  it("does not throw and returns empty staleTokens when Expo receipt fetch fails", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockRejectedValue(new Error("Network error"));

    await expect(checkPushReceipts()).resolves.not.toThrow();
    const result = await checkPushReceipts();
    expect(result.staleTokens).toEqual([]);
  });

  it("works without onStaleToken option and still returns stale tokens", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    const result = await checkPushReceipts();

    expect(result.staleTokens).toEqual([TOKEN_A]);
  });

  it("removes the ticket even when its receipt is absent from the response", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({});

    const onStaleToken = vi.fn();
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([]);
    expect(onStaleToken).not.toHaveBeenCalled();
    expect(_pendingTickets.size).toBe(0);
  });
});

describe("full flow: sendPushNotifications → checkPushReceipts", () => {
  it("end-to-end: token registered via send, then cleared when receipt is DeviceNotRegistered", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-abc" },
    ]);
    await sendPushNotifications([TOKEN_A], PAYLOAD);
    expect(_pendingTickets.get("ticket-abc")).toBe(TOKEN_A);

    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-abc": {
        status: "error",
        details: { error: "DeviceNotRegistered" },
      },
    });

    const onStaleToken = vi.fn().mockResolvedValue(undefined);
    const result = await checkPushReceipts({ onStaleToken });

    expect(result.staleTokens).toEqual([TOKEN_A]);
    expect(onStaleToken).toHaveBeenCalledWith(TOKEN_A);
    expect(_pendingTickets.size).toBe(0);
  });
});
