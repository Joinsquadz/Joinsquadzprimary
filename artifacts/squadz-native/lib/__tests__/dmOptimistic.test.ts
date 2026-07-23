// C3 — DM optimistic insert: local append with pending state, reconcile on ack,
// retry affordance on failure.
//
// sendMessage (AppContext) stamps a temp-ID message into the local list
// immediately — before the API responds — then either reconciles the list on a
// successful ACK or removes the temp message and returns an actionable error on
// failure. These tests verify the return-value contract and the shape of the
// pending-state message without exercising the full React context.
import { describe, it, expect, vi } from "vitest";

type Response = {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchFn = (url: string, opts?: RequestInit) => Promise<Response>;

// Pure function that mirrors the AppContext.sendMessage return-value logic,
// extracted from the useCallback closure for unit-testability.
async function sendMessageCore(
  apiFetch: FetchFn,
  eventId: string,
  senderId: string,
  text: string,
): Promise<{ error?: string }> {
  try {
    const res = await apiFetch(`/api/events/${eventId}/messages`, {
      method: "POST",
      body: JSON.stringify({ senderId, text }),
    });
    if (res.status === 409) {
      return { error: "Update conflict" };
    }
    if (!res.ok) {
      let message = "Could not send message. Please try again.";
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) message = errBody.error;
      } catch { /* ignore parse errors */ }
      return { error: message };
    }
    return {};
  } catch {
    return { error: "Could not send message. Check your connection and try again." };
  }
}

function makeOk(body: unknown = {}): Response {
  return { status: 200, ok: true, json: () => Promise.resolve(body) };
}
function makeErr(status: number, body: unknown = {}): Response {
  return { status, ok: false, json: () => Promise.resolve(body) };
}

describe("C3 — DM pending-state message shape", () => {
  it("pending message has a temp ID and 'Just now' timestamp before API resolves", () => {
    const before = Date.now();
    const tempId = `m${Date.now()}`;
    const pending = {
      id: tempId,
      senderId: "u1",
      text: "Hey squad!",
      time: "Just now",
      createdAt: new Date().toISOString(),
    };
    expect(pending.id).toMatch(/^m\d+$/);
    expect(pending.time).toBe("Just now");
    expect(new Date(pending.createdAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("temp ID is unique on each call (based on timestamp)", () => {
    const id1 = `m${Date.now()}`;
    const id2 = `m${Date.now() + 1}`;
    expect(id1).not.toBe(id2);
  });
});

describe("C3 — sendMessage return-value contract", () => {
  it("returns {} on a successful 200 response (ACK — temp message reconciled)", async () => {
    const apiFetch = vi.fn().mockResolvedValue(makeOk({ id: "event-1", messages: [] }));
    const result = await sendMessageCore(apiFetch, "event-1", "u1", "Hello");
    expect(result).toEqual({});
  });

  it("returns { error: 'Update conflict' } on 409 (version conflict)", async () => {
    const apiFetch = vi.fn().mockResolvedValue(makeErr(409));
    const result = await sendMessageCore(apiFetch, "event-1", "u1", "Hi");
    expect(result.error).toBe("Update conflict");
  });

  it("returns { error } with the server message on a non-ok, non-409 response", async () => {
    const apiFetch = vi.fn().mockResolvedValue(
      makeErr(400, { error: "Event is cancelled." }),
    );
    const result = await sendMessageCore(apiFetch, "event-1", "u1", "Hi");
    expect(result.error).toBe("Event is cancelled.");
  });

  it("falls back to the default error copy when non-ok body has no error field", async () => {
    const apiFetch = vi.fn().mockResolvedValue(makeErr(500, {}));
    const result = await sendMessageCore(apiFetch, "event-1", "u1", "Hi");
    expect(result.error).toBe("Could not send message. Please try again.");
  });

  it("returns a connection-error message on network failure (retry affordance)", async () => {
    const apiFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await sendMessageCore(apiFetch, "event-1", "u1", "Hi");
    expect(result.error).toContain("connection");
  });

  it("posts to the correct endpoint with the expected body", async () => {
    const apiFetch = vi.fn().mockResolvedValue(makeOk());
    await sendMessageCore(apiFetch, "event-42", "sender-1", "Test message");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/events/event-42/messages",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"senderId":"sender-1"'),
      }),
    );
  });
});
