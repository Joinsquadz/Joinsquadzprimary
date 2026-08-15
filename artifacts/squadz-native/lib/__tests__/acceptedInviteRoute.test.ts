import { describe, expect, it } from "vitest";
import { acceptedInviteRoute } from "../acceptedInviteRoute";

describe("acceptedInviteRoute", () => {
  it("opens an accepted trip at its trip detail screen", () => {
    expect(acceptedInviteRoute("trip-42", "trip")).toEqual({
      pathname: "/trip/[id]",
      params: { id: "trip-42" },
    });
  });

  it("opens a normal event and keeps old activity rows compatible", () => {
    expect(acceptedInviteRoute("event-42", "event")).toEqual({
      pathname: "/event/[id]",
      params: { id: "event-42" },
    });
    expect(acceptedInviteRoute("older-event")).toEqual({
      pathname: "/event/[id]",
      params: { id: "older-event" },
    });
  });

  it("does not navigate when the activity row has no event id", () => {
    expect(acceptedInviteRoute(undefined, "trip")).toBeNull();
  });
});