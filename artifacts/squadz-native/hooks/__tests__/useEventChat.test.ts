// @vitest-environment happy-dom
//
// Plan (event / trip) chat is backed by a conversation thread rather than an
// array on the event record. These tests pin the behaviours that regressed most
// easily during that migration:
//   - the thread is created LAZILY (only once the Chat tab is actually open)
//   - a pre-token-restore 401 keeps the tab loading instead of flashing empty
//   - losing access mid-session surfaces as `denied`, not an empty thread
//   - switching plans never bleeds one plan's history into another's
//   - sends no longer carry an event version, so they can't 409 on each other
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const authState = vi.hoisted(() => ({ token: "tok" as string | null }));

const api = vi.hoisted(() => ({
  getEventConversation: vi.fn(),
  fetchThread: vi.fn(),
  sendMessage: vi.fn(),
  markRead: vi.fn(),
}));

const streamState = vi.hoisted(() => ({ lastConversationId: undefined as unknown }));

vi.mock("@/context/AppContext", () => ({
  useAuth: () => ({ authToken: authState.token }),
}));

vi.mock("@/context/MessagesContext", () => ({
  useMessages: () => api,
}));

vi.mock("@/hooks/useConversationStream", () => ({
  useConversationStream: ({ conversationId }: { conversationId: string | null }) => {
    streamState.lastConversationId = conversationId;
    return { status: "connected", retry: () => {} };
  },
}));

import { useEventChat } from "../useEventChat";

function message(id: string, text = "hi", createdAt = "2026-01-01T00:00:00.000Z") {
  return { id, conversationId: "c1", senderId: "u1", text, attachments: [], createdAt };
}

function threadOk(messages: ReturnType<typeof message>[], hasMore = false, nextCursor: string | null = null) {
  return {
    kind: "ok" as const,
    data: {
      conversation: { id: "c1", type: "event", squadId: null, eventId: "e1" },
      messages,
      participants: [],
      hasMore,
      nextCursor,
    },
  };
}

beforeEach(() => {
  authState.token = "tok";
  streamState.lastConversationId = undefined;
  api.getEventConversation.mockReset().mockResolvedValue("c1");
  api.fetchThread.mockReset().mockResolvedValue(threadOk([message("m1")]));
  api.sendMessage.mockReset().mockResolvedValue({ ok: true, message: message("m2", "sent") });
  api.markRead.mockReset().mockResolvedValue(undefined);
});

describe("useEventChat — lazy thread creation", () => {
  it("does not touch the server while the chat tab is closed", async () => {
    renderHook(() => useEventChat("e1", false));
    await act(async () => {});
    expect(api.getEventConversation).not.toHaveBeenCalled();
    expect(api.fetchThread).not.toHaveBeenCalled();
    // No SSE connection behind a closed tab.
    expect(streamState.lastConversationId).toBeNull();
  });

  it("opens the thread, loads it and marks it read once the tab is active", async () => {
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(api.getEventConversation).toHaveBeenCalledWith("e1");
    expect(api.markRead).toHaveBeenCalledWith("c1");
    expect(result.current.conversationId).toBe("c1");
    expect(streamState.lastConversationId).toBe("c1");
  });
});

describe("useEventChat — auth race vs. real access loss", () => {
  it("keeps loading (not empty) when the thread can't be opened yet", async () => {
    api.getEventConversation.mockResolvedValue(null);
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.authPending).toBe(true));
    // Crucially NOT denied — a 401 before the token restores must not be
    // reported to the user as "you lost access".
    expect(result.current.denied).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it("reports denied when an opened thread starts failing with nothing loaded", async () => {
    api.fetchThread.mockResolvedValue({ kind: "failure" as const });
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.denied).toBe(true));
  });
});

describe("useEventChat — pagination + plan switching", () => {
  it("prepends older pages without duplicating the latest page", async () => {
    api.fetchThread.mockResolvedValueOnce(threadOk([message("m5")], true, "m5"));
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    api.fetchThread.mockResolvedValueOnce(
      threadOk([message("m3", "older", "2025-12-31T00:00:00.000Z"), message("m5")], false, null),
    );
    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(["m3", "m5"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("clears history when the screen is reused for a different plan", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useEventChat(id, true),
      { initialProps: { id: "e1" } },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    api.getEventConversation.mockResolvedValue("c2");
    api.fetchThread.mockResolvedValue(threadOk([message("z1", "other plan")]));
    rerender({ id: "e2" });

    await waitFor(() => expect(result.current.conversationId).toBe("c2"));
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(["z1"]));
  });
});

describe("useEventChat — sending", () => {
  it("posts to the conversation (no event version) and appends the ack", async () => {
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.conversationId).toBe("c1"));

    let outcome: { error?: string } = {};
    await act(async () => {
      outcome = await result.current.send("hello");
    });

    expect(outcome).toEqual({});
    expect(api.sendMessage).toHaveBeenCalledWith("c1", "hello", []);
    // No `version` anywhere in the call — concurrent senders can't 409.
    expect(JSON.stringify(api.sendMessage.mock.calls[0])).not.toContain("version");
    expect(result.current.messages.map((m) => m.id)).toContain("m2");
  });

  it("surfaces a blocked send as an error instead of silently dropping it", async () => {
    api.sendMessage.mockResolvedValue({ ok: false, blocked: true });
    const { result } = renderHook(() => useEventChat("e1", true));
    await waitFor(() => expect(result.current.conversationId).toBe("c1"));

    let outcome: { error?: string } = {};
    await act(async () => {
      outcome = await result.current.send("hello");
    });
    expect(outcome.error).toBeTruthy();
  });

  it("refuses to send before the thread exists", async () => {
    const { result } = renderHook(() => useEventChat("e1", false));
    let outcome: { error?: string } = {};
    await act(async () => {
      outcome = await result.current.send("hello");
    });
    expect(outcome.error).toBeTruthy();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});
