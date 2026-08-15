import { describe, it, expect } from "vitest";
import { eventRosterKey } from "../eventUtils";

// ---------------------------------------------------------------------------
// Regression: the host's open event screen didn't show new guests until the app
// was closed and reopened. Two causes, both fixed:
//   1. the screen refreshed the whole (paginated, upcoming-only) events list
//      instead of the plan it has open — now AppContext.refreshEvent(id);
//   2. the user-profile prefetch was keyed on event.id, so a guest who RSVP'd
//      while the screen was open was never fetched into the user cache.
// This locks in (2): the roster key must change the moment the roster changes,
// and must NOT churn when nothing relevant changed (a new key re-runs the
// prefetch on every render — see the refetch-flicker class of bugs).
// ---------------------------------------------------------------------------

type RosterEvent = Parameters<typeof eventRosterKey>[0];

function makeEvent(overrides: Partial<RosterEvent> = {}): RosterEvent {
  return {
    hostId: "host-1",
    rsvps: {},
    invitedUserIds: [],
    tasks: [],
    costs: [],
    ...overrides,
  } as RosterEvent;
}

describe("eventRosterKey", () => {
  it("changes when a guest RSVPs while the host has the screen open", () => {
    const before = eventRosterKey(makeEvent({ rsvps: { "host-1": "going" } }));
    const after = eventRosterKey(
      makeEvent({ rsvps: { "host-1": "going", "guest-2": "going" } }),
    );

    expect(after).not.toBe(before);
    expect(after).toContain("guest-2");
  });

  it("changes when a second guest joins (the reported two-attendee case)", () => {
    const one = eventRosterKey(makeEvent({ rsvps: { "host-1": "going", "guest-2": "going" } }));
    const two = eventRosterKey(
      makeEvent({ rsvps: { "host-1": "going", "guest-2": "going", "guest-3": "maybe" } }),
    );

    expect(two).not.toBe(one);
    expect(two).toContain("guest-3");
  });

  it("includes directly invited users who haven't replied yet", () => {
    const key = eventRosterKey(makeEvent({ invitedUserIds: ["pending-9"] }));

    expect(key).toContain("pending-9");
  });

  it("is stable when the same roster arrives in a different order", () => {
    const a = eventRosterKey(
      makeEvent({ rsvps: { "guest-2": "going", "guest-3": "maybe" }, invitedUserIds: ["p-1"] }),
    );
    const b = eventRosterKey(
      makeEvent({ rsvps: { "guest-3": "maybe", "guest-2": "going" }, invitedUserIds: ["p-1"] }),
    );

    expect(a).toBe(b);
  });

  it("ignores changes that don't add a person (RSVP status flips)", () => {
    const going = eventRosterKey(makeEvent({ rsvps: { "guest-2": "going" } }));
    const maybe = eventRosterKey(makeEvent({ rsvps: { "guest-2": "maybe" } }));

    expect(maybe).toBe(going);
  });

  it("tolerates missing optional collections", () => {
    expect(() =>
      eventRosterKey({ hostId: "host-1" } as unknown as RosterEvent),
    ).not.toThrow();
  });
});
