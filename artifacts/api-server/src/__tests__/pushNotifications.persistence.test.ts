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
      chunkPushNotificationReceiptIds: mockChunkPushReceiptIds,
      getPushNotificationReceiptsAsync: mockGetPushNotificationReceiptsAsync,
    });
  }
  ExpoMock.isExpoPushToken = mockIsExpoPushToken;
  return { Expo: ExpoMock };
});

vi.mock("../lib/logger");

// storePushTicket is kept for other callers but sendPushNotifications now
// uses storePushTicketsBatch to cap concurrent DB writes.
const mockStorePushTicket = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockStorePushTicketsBatch = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const mockDeletePushTickets = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockLoadAllPushTickets = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    storePushTicket: mockStorePushTicket,
    storePushTicketsBatch: mockStorePushTicketsBatch,
    deletePushTickets: mockDeletePushTickets,
    loadAllPushTickets: mockLoadAllPushTickets,
  },
}));

import {
  sendPushNotifications,
  checkPushReceipts,
  initPushTickets,
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
  mockStorePushTicketsBatch.mockResolvedValue(undefined);
  mockDeletePushTickets.mockResolvedValue(undefined);
  mockLoadAllPushTickets.mockResolvedValue(new Map());
});

describe("sendPushNotifications — DB persistence", () => {
  it("batch-stores ok tickets after the send loop completes", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);
    await vi.waitFor(() => expect(mockStorePushTicketsBatch).toHaveBeenCalledTimes(1));

    expect(mockStorePushTicketsBatch).toHaveBeenCalledWith([
      { ticketId: "ticket-1", pushToken: TOKEN_A },
    ]);
  });

  it("collects all ok tickets across a multi-token send into a single batch call", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
      { status: "ok", id: "ticket-2" },
    ]);

    await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD);
    await vi.waitFor(() => expect(mockStorePushTicketsBatch).toHaveBeenCalledTimes(1));

    expect(mockStorePushTicketsBatch).toHaveBeenCalledWith([
      { ticketId: "ticket-1", pushToken: TOKEN_A },
      { ticketId: "ticket-2", pushToken: TOKEN_B },
    ]);
  });

  it("does NOT call storePushTicketsBatch when all tickets are DeviceNotRegistered errors", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);
    await new Promise((r) => setImmediate(r));

    expect(mockStorePushTicketsBatch).not.toHaveBeenCalled();
  });

  it("does NOT call storePushTicketsBatch when all tickets are other error types", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "error", details: { error: "MessageTooBig" } },
    ]);

    await sendPushNotifications([TOKEN_A], PAYLOAD);
    await new Promise((r) => setImmediate(r));

    expect(mockStorePushTicketsBatch).not.toHaveBeenCalled();
  });

  it("batch stores only the ok ticket from a mixed ok+error response", async () => {
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]);

    await sendPushNotifications([TOKEN_A, TOKEN_B], PAYLOAD);
    await vi.waitFor(() => expect(mockStorePushTicketsBatch).toHaveBeenCalledTimes(1));

    expect(mockStorePushTicketsBatch).toHaveBeenCalledWith([
      { ticketId: "ticket-1", pushToken: TOKEN_A },
    ]);
  });

  it("does not throw when storePushTicketsBatch rejects", async () => {
    mockStorePushTicketsBatch.mockRejectedValue(new Error("DB error"));
    mockSendPushNotificationsAsync.mockResolvedValue([
      { status: "ok", id: "ticket-1" },
    ]);

    await expect(sendPushNotifications([TOKEN_A], PAYLOAD)).resolves.not.toThrow();
  });
});

describe("checkPushReceipts — DB persistence", () => {
  it("calls deletePushTickets with processed ticket IDs after checking receipts", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    await checkPushReceipts();
    await vi.waitFor(() => expect(mockDeletePushTickets).toHaveBeenCalledTimes(1));

    expect(mockDeletePushTickets).toHaveBeenCalledWith(["ticket-1"]);
  });

  it("deletes all processed tickets including stale ones", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    _pendingTickets.set("ticket-2", TOKEN_B);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
      "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } },
    });

    await checkPushReceipts();
    await vi.waitFor(() => expect(mockDeletePushTickets).toHaveBeenCalledTimes(1));

    const [deletedIds] = mockDeletePushTickets.mock.calls[0] as [string[]];
    expect(deletedIds).toHaveLength(2);
    expect(deletedIds).toContain("ticket-1");
    expect(deletedIds).toContain("ticket-2");
  });

  it("deletes ticket even when its receipt is absent from the response", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({});

    await checkPushReceipts();
    await vi.waitFor(() => expect(mockDeletePushTickets).toHaveBeenCalledTimes(1));

    expect(mockDeletePushTickets).toHaveBeenCalledWith(["ticket-1"]);
  });

  it("does NOT call deletePushTickets when there are no pending tickets", async () => {
    await checkPushReceipts();
    await new Promise((r) => setImmediate(r));

    expect(mockDeletePushTickets).not.toHaveBeenCalled();
  });

  it("does not throw when deletePushTickets rejects", async () => {
    _pendingTickets.set("ticket-1", TOKEN_A);
    mockDeletePushTickets.mockRejectedValue(new Error("DB error"));
    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      "ticket-1": { status: "ok" },
    });

    await expect(checkPushReceipts()).resolves.not.toThrow();
  });
});

describe("initPushTickets — startup DB load", () => {
  it("populates _pendingTickets from the DB on startup", async () => {
    const dbTickets = new Map([
      ["ticket-a", TOKEN_A],
      ["ticket-b", TOKEN_B],
    ]);
    mockLoadAllPushTickets.mockResolvedValue(dbTickets);

    await initPushTickets();

    expect(_pendingTickets.get("ticket-a")).toBe(TOKEN_A);
    expect(_pendingTickets.get("ticket-b")).toBe(TOKEN_B);
  });

  it("does nothing when there are no persisted tickets", async () => {
    mockLoadAllPushTickets.mockResolvedValue(new Map());

    await initPushTickets();

    expect(_pendingTickets.size).toBe(0);
  });

  it("does not throw when loadAllPushTickets rejects", async () => {
    mockLoadAllPushTickets.mockRejectedValue(new Error("DB error"));

    await expect(initPushTickets()).resolves.not.toThrow();
  });

  it("does not overwrite in-memory tickets already present at startup", async () => {
    _pendingTickets.set("existing-ticket", TOKEN_A);
    const dbTickets = new Map([["db-ticket", TOKEN_B]]);
    mockLoadAllPushTickets.mockResolvedValue(dbTickets);

    await initPushTickets();

    expect(_pendingTickets.get("existing-ticket")).toBe(TOKEN_A);
    expect(_pendingTickets.get("db-ticket")).toBe(TOKEN_B);
  });
});
