import { describe, it, expect } from "vitest";

import {
  getPlanSpan,
  spansOverlap,
  isOwnPlan,
  findMyConflicts,
  conflictMessage,
  type PlanSpan,
} from "../conflicts";
import type { Event, Squad } from "@/types";

const ME = "me";

const plan = (over: Partial<Event> & { id: string }): Event => ({
  emoji: "🔥",
  title: "Bonfire",
  date: "Sat, Jul 18 · 8:00 PM",
  type: "event",
  location: "The Beach",
  squadId: "s1",
  squadName: "The Crew",
  hostId: "other",
  rsvps: {},
  invitedUserIds: [],
  description: "",
  inviteCode: "abc",
  tasks: [],
  costs: [],
  polls: [],
  itinerary: [],
  packing: [],
  version: 1,
  ...over,
});

const squad = (over: Partial<Squad> & { id: string }): Squad => ({
  name: "The Crew",
  emoji: "🔥",
  memberIds: [],
  color: "#f00",
  ...over,
});

describe("getPlanSpan", () => {
  it("trip → date range", () => {
    const s = getPlanSpan(
      plan({ id: "t1", type: "trip", startAt: "2026-07-17T12:00:00Z", endAt: "2026-07-19T12:00:00Z" }),
    );
    expect(s?.kind).toBe("range");
  });

  it("event with eventAt → timed span", () => {
    const s = getPlanSpan(plan({ id: "e1", eventAt: "2026-07-18T20:00:00Z" }));
    expect(s?.kind).toBe("timed");
  });

  it("event with only a timed display date → timed span", () => {
    const s = getPlanSpan(plan({ id: "e2", date: "Sat, Jul 18 · 8:00 PM" }));
    expect(s?.kind).toBe("timed");
  });

  it("event with a time-less display date → day span", () => {
    const s = getPlanSpan(plan({ id: "e3", date: "Sat, Jul 18" }));
    expect(s?.kind).toBe("day");
  });

  it("unusable date → null", () => {
    expect(getPlanSpan(plan({ id: "e4", date: "sometime" }))).toBeNull();
  });
});

describe("spansOverlap", () => {
  const day = (d: string): PlanSpan => ({ kind: "day", day: d });
  const range = (a: string, b: string): PlanSpan => ({ kind: "range", startDay: a, endDay: b });
  const timed = (d: string, sh: number, eh: number): PlanSpan => ({
    kind: "timed",
    day: d,
    startMs: new Date(`${d}T00:00:00`).getTime() + sh * 3_600_000,
    endMs: new Date(`${d}T00:00:00`).getTime() + eh * 3_600_000,
  });

  it("trip vs trip: intersecting ranges → hard", () => {
    expect(spansOverlap(range("2026-07-17", "2026-07-19"), range("2026-07-19", "2026-07-21"))).toBe("hard");
    expect(spansOverlap(range("2026-07-17", "2026-07-19"), range("2026-07-20", "2026-07-21"))).toBeNull();
  });

  it("trip vs event: day inside range → hard", () => {
    expect(spansOverlap(range("2026-07-17", "2026-07-19"), timed("2026-07-18", 20, 22))).toBe("hard");
    expect(spansOverlap(range("2026-07-17", "2026-07-19"), day("2026-07-18"))).toBe("hard");
    expect(spansOverlap(range("2026-07-17", "2026-07-19"), day("2026-07-25"))).toBeNull();
  });

  it("event vs event same day: timed overlap → hard, disjoint times → null", () => {
    expect(spansOverlap(timed("2026-07-18", 20, 22), timed("2026-07-18", 21, 23))).toBe("hard");
    expect(spansOverlap(timed("2026-07-18", 10, 12), timed("2026-07-18", 20, 22))).toBeNull();
  });

  it("event vs event same day: missing time → soft", () => {
    expect(spansOverlap(timed("2026-07-18", 20, 22), day("2026-07-18"))).toBe("soft");
    expect(spansOverlap(day("2026-07-18"), day("2026-07-18"))).toBe("soft");
    expect(spansOverlap(day("2026-07-18"), day("2026-07-19"))).toBeNull();
  });
});

describe("isOwnPlan", () => {
  it("events: host / going / maybe count, notgoing and strangers don't", () => {
    expect(isOwnPlan(plan({ id: "e1", hostId: ME }), ME, [])).toBe(true);
    expect(isOwnPlan(plan({ id: "e2", rsvps: { [ME]: "going" } }), ME, [])).toBe(true);
    expect(isOwnPlan(plan({ id: "e3", rsvps: { [ME]: "maybe" } }), ME, [])).toBe(true);
    expect(isOwnPlan(plan({ id: "e4", rsvps: { [ME]: "notgoing" } }), ME, [])).toBe(false);
    expect(isOwnPlan(plan({ id: "e5" }), ME, [])).toBe(false);
  });

  it("trips: roster membership via the trip's squad + invites + host", () => {
    const sq = squad({ id: "s1", memberIds: [ME, "other"] });
    expect(isOwnPlan(plan({ id: "t1", type: "trip", squadId: "s1" }), ME, [sq])).toBe(true);
    expect(isOwnPlan(plan({ id: "t2", type: "trip", squadId: "s2" }), ME, [sq])).toBe(false);
    expect(isOwnPlan(plan({ id: "t3", type: "trip", squadId: "s2", invitedUserIds: [ME] }), ME, [sq])).toBe(true);
  });
});

describe("findMyConflicts", () => {
  const myTrip = plan({
    id: "trip1",
    type: "trip",
    title: "Lake Weekend",
    squadId: "s1",
    squadName: "Lake Crew",
    startAt: "2026-07-17T12:00:00Z",
    endAt: "2026-07-19T12:00:00Z",
  });
  const mySquads = [squad({ id: "s1", memberIds: [ME] })];

  it("detects cross-squad collisions but only for the user's own plans", () => {
    const candidate = getPlanSpan(plan({ id: "new", eventAt: "2026-07-18T20:00:00Z" }));
    const strangersTrip = plan({ ...myTrip, id: "trip2", squadId: "s9", squadName: "Not mine" });

    const found = findMyConflicts({
      candidate,
      plans: [myTrip, strangersTrip],
      userId: ME,
      squads: mySquads,
    });
    expect(found).toHaveLength(1);
    expect(found[0].plan.id).toBe("trip1");
    expect(found[0].level).toBe("hard");
  });

  it("skips the candidate itself and cancelled plans", () => {
    const candidate = getPlanSpan(myTrip);
    const cancelled = plan({ ...myTrip, id: "trip3", cancelled: true });
    const found = findMyConflicts({
      candidate,
      plans: [myTrip, cancelled],
      userId: ME,
      squads: mySquads,
      excludeId: "trip1",
    });
    expect(found).toHaveLength(0);
  });

  it("returns [] for a null candidate", () => {
    expect(findMyConflicts({ candidate: null, plans: [myTrip], userId: ME, squads: mySquads })).toEqual([]);
  });
});

describe("conflictMessage", () => {
  const p = plan({ id: "e1", title: "Bonfire", squadName: "Beach Crew" });

  it("null for no conflicts", () => {
    expect(conflictMessage([])).toBeNull();
  });

  it("names the plan and squad for a single conflict", () => {
    expect(conflictMessage([{ plan: p, level: "hard" }])).toContain("Bonfire");
    expect(conflictMessage([{ plan: p, level: "hard" }])).toContain("Beach Crew");
    expect(conflictMessage([{ plan: p, level: "soft" }])).toContain("also on this day");
  });

  it("counts multiple conflicts", () => {
    const msg = conflictMessage([
      { plan: p, level: "hard" },
      { plan: plan({ id: "e2" }), level: "soft" },
    ]);
    expect(msg).toContain("2 other plans");
  });
});
