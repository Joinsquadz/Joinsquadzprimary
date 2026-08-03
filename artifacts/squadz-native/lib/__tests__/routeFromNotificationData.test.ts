import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file, so mock functions must be defined
// with vi.hoisted to be available inside the factory.
const { mockRouterPush, mockRouterNavigate } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockRouterNavigate: vi.fn(),
}));

vi.mock("expo-router", () => ({
  router: {
    push: mockRouterPush,
    navigate: mockRouterNavigate,
  },
}));

import { routeFromNotificationData } from "@/lib/routeFromNotificationData";

beforeEach(() => {
  mockRouterPush.mockClear();
  mockRouterNavigate.mockClear();
});

describe("routeFromNotificationData", () => {
  // ── guard cases ────────────────────────────────────────────────────────────

  it("is a no-op when data is undefined", () => {
    routeFromNotificationData(undefined);
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  it("is a no-op when data has no screen property", () => {
    routeFromNotificationData({ squadId: "1" });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown screen value", () => {
    routeFromNotificationData({ screen: "totally-unknown-screen" });
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  // ── feed ──────────────────────────────────────────────────────────────────

  it("navigates to the feed tab for screen=feed", () => {
    routeFromNotificationData({ screen: "feed" });
    expect(mockRouterNavigate).toHaveBeenCalledOnce();
    expect(mockRouterNavigate).toHaveBeenCalledWith("/(tabs)/feed");
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── activity ──────────────────────────────────────────────────────────────

  it("pushes /activity for screen=activity", () => {
    routeFromNotificationData({ screen: "activity" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith("/activity");
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  // ── friends ───────────────────────────────────────────────────────────────

  it("pushes /friends for screen=friends", () => {
    routeFromNotificationData({ screen: "friends" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith("/friends");
  });

  // ── availability ──────────────────────────────────────────────────────────

  it("pushes /availability with squadId for screen=availability + squadId", () => {
    routeFromNotificationData({ screen: "availability", squadId: "sq1" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/availability",
      params: { squadId: "sq1" },
    });
  });

  it("pushes /availability with eventId for screen=availability + eventId (no squadId)", () => {
    routeFromNotificationData({ screen: "availability", eventId: "ev1" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/availability",
      params: { eventId: "ev1" },
    });
  });

  it("is a no-op for screen=availability with neither squadId nor eventId", () => {
    routeFromNotificationData({ screen: "availability" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── conversation ──────────────────────────────────────────────────────────

  it("pushes /conversation/[id] for screen=conversation", () => {
    routeFromNotificationData({ screen: "conversation", conversationId: "conv42" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/conversation/[id]",
      params: { id: "conv42" },
    });
  });

  it("is a no-op for screen=conversation without conversationId", () => {
    routeFromNotificationData({ screen: "conversation" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── event ─────────────────────────────────────────────────────────────────

  it("pushes /event/[id] for screen=event", () => {
    routeFromNotificationData({ screen: "event", eventId: "ev7" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/event/[id]",
      params: { id: "ev7" },
    });
  });

  it("includes tab param in event push when provided", () => {
    routeFromNotificationData({ screen: "event", eventId: "ev7", tab: "chat" });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/event/[id]",
      params: { id: "ev7", tab: "chat" },
    });
  });

  it("is a no-op for screen=event without eventId", () => {
    routeFromNotificationData({ screen: "event" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── trip ──────────────────────────────────────────────────────────────────

  it("pushes /trip/[id] for screen=trip", () => {
    routeFromNotificationData({ screen: "trip", eventId: "tr3" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/trip/[id]",
      params: { id: "tr3" },
    });
  });

  it("includes tab param in trip push when provided", () => {
    routeFromNotificationData({ screen: "trip", eventId: "tr3", tab: "ideas" });
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/trip/[id]",
      params: { id: "tr3", tab: "ideas" },
    });
  });

  it("is a no-op for screen=trip without eventId", () => {
    routeFromNotificationData({ screen: "trip" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── squad ─────────────────────────────────────────────────────────────────

  it("pushes /squad/[id] for screen=squad", () => {
    routeFromNotificationData({ screen: "squad", squadId: "sq9" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/squad/[id]",
      params: { id: "sq9" },
    });
  });

  it("is a no-op for screen=squad without squadId", () => {
    routeFromNotificationData({ screen: "squad" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  // ── vault ─────────────────────────────────────────────────────────────────

  it("pushes /vault with photoId + squadId for screen=vault + photoId", () => {
    routeFromNotificationData({ screen: "vault", squadId: "sq1", photoId: "ph5" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/vault",
      params: { squadId: "sq1", photoId: "ph5" },
    });
  });

  it("pushes /vault with photoId + eventId for screen=vault + photoId + eventId", () => {
    routeFromNotificationData({ screen: "vault", eventId: "ev2", photoId: "ph6" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/vault",
      params: { eventId: "ev2", photoId: "ph6" },
    });
  });

  it("pushes /vault with squadId (no photoId) for screen=vault + squadId", () => {
    routeFromNotificationData({ screen: "vault", squadId: "sq1" });
    expect(mockRouterPush).toHaveBeenCalledOnce();
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/vault",
      params: { squadId: "sq1" },
    });
  });

  it("is a no-op for screen=vault with neither photoId nor squadId", () => {
    routeFromNotificationData({ screen: "vault" });
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
