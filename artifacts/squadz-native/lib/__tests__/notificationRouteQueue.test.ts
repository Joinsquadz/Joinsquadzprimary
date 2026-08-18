import { describe, expect, it } from "vitest";
import { createNotificationRouteDrainer } from "../notificationRouteQueue";

describe("createNotificationRouteDrainer", () => {
  it("keeps a later queued notification behind the active navigation", () => {
    const routed: string[] = [];
    const scheduled: Array<() => void> = [];
    const settled: string[] = [];
    const drainer = createNotificationRouteDrainer<string>(
      (route) => routed.push(route),
      (done) => scheduled.push(done),
      () => settled.push("settled"),
    );

    expect(drainer.drain("trip-1")).toBe(true);
    // This models a second notification arriving before InteractionManager
    // declares the first stack transition complete.
    expect(drainer.drain("event-2")).toBe(false);
    expect(routed).toEqual(["trip-1"]);
    expect(drainer.isDraining()).toBe(true);

    scheduled.shift()?.();
    expect(settled).toEqual(["settled"]);
    expect(drainer.isDraining()).toBe(false);

    expect(drainer.drain("event-2")).toBe(true);
    scheduled.shift()?.();
    expect(routed).toEqual(["trip-1", "event-2"]);
    expect(settled).toEqual(["settled", "settled"]);
  });
});