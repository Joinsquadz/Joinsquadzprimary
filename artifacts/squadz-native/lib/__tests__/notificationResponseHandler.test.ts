import { describe, it, expect, vi, beforeEach } from "vitest";
import { createNotificationResponseHandler } from "@/lib/notificationResponseHandler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal notification-response object. */
function makeResponse(
  identifier: string | undefined,
  data?: Record<string, string>,
): { notification: { request: { identifier?: string; content: { data?: unknown } } } } {
  return {
    notification: {
      request: {
        ...(identifier !== undefined ? { identifier } : {}),
        content: { data },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createNotificationResponseHandler – dedup logic", () => {
  let handledIds: Set<string>;
  let route: ReturnType<typeof vi.fn<(data: Record<string, string> | undefined) => void>>;
  let handler: ReturnType<typeof createNotificationResponseHandler>;

  beforeEach(() => {
    handledIds = new Set();
    route = vi.fn<(data: Record<string, string> | undefined) => void>();
    handler = createNotificationResponseHandler(handledIds, route);
  });

  // ── first-call (cold-start) path ─────────────────────────────────────────

  it("calls route on the very first response with a given identifier", () => {
    handler(makeResponse("notif-1", { screen: "activity" }));
    expect(route).toHaveBeenCalledOnce();
    expect(route).toHaveBeenCalledWith({ screen: "activity" });
  });

  it("calls route when the identifier is undefined (no dedup applied)", () => {
    handler(makeResponse(undefined, { screen: "feed" }));
    expect(route).toHaveBeenCalledOnce();
  });

  it("adds the identifier to handledIds after the first call", () => {
    handler(makeResponse("notif-1"));
    expect(handledIds.has("notif-1")).toBe(true);
  });

  // ── second-call (duplicate) is a no-op ───────────────────────────────────

  it("does NOT call route on a second response with the same identifier", () => {
    handler(makeResponse("notif-1", { screen: "activity" }));
    handler(makeResponse("notif-1", { screen: "activity" }));
    expect(route).toHaveBeenCalledOnce(); // only the first call goes through
  });

  it("does not add a duplicate to handledIds (size stays 1)", () => {
    handler(makeResponse("notif-1"));
    handler(makeResponse("notif-1"));
    expect(handledIds.size).toBe(1);
  });

  // ── distinct identifiers are each routed once ─────────────────────────────

  it("routes distinct identifiers independently", () => {
    handler(makeResponse("notif-1", { screen: "activity" }));
    handler(makeResponse("notif-2", { screen: "feed" }));
    expect(route).toHaveBeenCalledTimes(2);
    expect(route).toHaveBeenNthCalledWith(1, { screen: "activity" });
    expect(route).toHaveBeenNthCalledWith(2, { screen: "feed" });
  });

  it("blocks only the repeated identifier while letting the other through", () => {
    handler(makeResponse("notif-1", { screen: "activity" }));
    handler(makeResponse("notif-1", { screen: "activity" })); // dup — blocked
    handler(makeResponse("notif-2", { screen: "feed" }));    // new — allowed
    expect(route).toHaveBeenCalledTimes(2);
  });

  // ── cold-start simulation: same Set across handler calls ─────────────────
  // The cold-start flow calls handleNotificationResponse twice:
  //   once via the live listener, once via getLastNotificationResponseAsync.
  // Dedup must prevent the double-route even when both calls happen in
  // rapid succession from the same async block.

  it("simulates cold-start: live listener + getLastNotificationResponseAsync both fire, only one route", () => {
    const liveResponse = makeResponse("cold-start-id", { screen: "event", eventId: "ev1" });
    const coldResponse = makeResponse("cold-start-id", { screen: "event", eventId: "ev1" });

    // Both calls share the same handledIds Set (as in the real component).
    handler(liveResponse);   // fires — this represents the cold-start explicit call
    handler(coldResponse);   // dup — this represents the listener firing with the same notif
    expect(route).toHaveBeenCalledOnce();
  });

  // ── no-identifier responses are always routed (can't dedup without id) ────

  it("routes every no-identifier response (multiple allowed)", () => {
    handler(makeResponse(undefined, { screen: "feed" }));
    handler(makeResponse(undefined, { screen: "feed" }));
    expect(route).toHaveBeenCalledTimes(2);
  });

  // ── data payload forwarding ───────────────────────────────────────────────

  it("forwards undefined data to route when notification has no data", () => {
    handler(makeResponse("notif-x"));
    expect(route).toHaveBeenCalledWith(undefined);
  });

  it("forwards the full data payload to route", () => {
    const data = { screen: "squad", squadId: "sq9" };
    handler(makeResponse("notif-y", data));
    expect(route).toHaveBeenCalledWith(data);
  });
});
