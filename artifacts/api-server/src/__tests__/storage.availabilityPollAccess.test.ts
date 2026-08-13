import { describe, it, expect, vi, beforeEach } from "vitest";

// Only the `db` client is mocked (real drizzle schema/columns are used). The
// two collaborators canAccessAvailabilityPoll consults — squad membership and
// the linked event — are spied per test so each access branch is exercised in
// isolation.
vi.mock("@workspace/db", () => {
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  return { db: { select: () => builder } };
});

import { storage } from "../storage";
import type { AvailabilityPoll } from "@workspace/db";

const CREATOR = "creator-id";
const MEMBER = "member-id";
const OUTSIDER = "outsider-id";

type StorageInternals = {
  isSquadMember: (squadId: string, userId: string) => Promise<boolean>;
  getEvent: (eventId: string) => Promise<unknown>;
};

function mockMembership(memberIds: string[]) {
  return vi
    .spyOn(storage as unknown as StorageInternals, "isSquadMember")
    .mockImplementation(async (_squadId: string, userId: string) => memberIds.includes(userId));
}

function mockEvent(event: unknown) {
  return vi
    .spyOn(storage as unknown as StorageInternals, "getEvent")
    .mockResolvedValue(event as never);
}

const squadPoll = {
  id: "poll-squad",
  squadId: "squad-1",
  eventId: null,
  participantIds: null,
  createdBy: CREATOR,
} as unknown as AvailabilityPoll;

const eventPoll = {
  id: "poll-event",
  squadId: null,
  eventId: "event-1",
  participantIds: null,
  createdBy: CREATOR,
} as unknown as AvailabilityPoll;

const adhocPoll = {
  id: "poll-adhoc",
  squadId: null,
  eventId: null,
  participantIds: [MEMBER],
  createdBy: CREATOR,
} as unknown as AvailabilityPoll;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("canAccessAvailabilityPoll — scoped polls have no creator exception", () => {
  it("denies the creator of a SQUAD poll once they are no longer a squad member", async () => {
    // The creator made this poll, then left (or was removed from) the squad.
    // Live membership is the only thing that counts.
    mockMembership([MEMBER]);

    await expect(storage.canAccessAvailabilityPoll(squadPoll, CREATOR)).resolves.toBe(false);
  });

  it("still allows the creator of a SQUAD poll while they remain a member", async () => {
    mockMembership([CREATOR, MEMBER]);

    await expect(storage.canAccessAvailabilityPoll(squadPoll, CREATOR)).resolves.toBe(true);
  });

  it("allows a current squad member who did not create the poll", async () => {
    mockMembership([CREATOR, MEMBER]);

    await expect(storage.canAccessAvailabilityPoll(squadPoll, MEMBER)).resolves.toBe(true);
  });

  it("denies an outsider on a squad poll", async () => {
    mockMembership([CREATOR, MEMBER]);

    await expect(storage.canAccessAvailabilityPoll(squadPoll, OUTSIDER)).resolves.toBe(false);
  });

  it("denies the creator of an EVENT poll who is neither host, squadmate, nor RSVP", async () => {
    mockMembership([]);
    mockEvent({ id: "event-1", hostId: "someone-else", squadId: null, rsvps: {} });

    await expect(storage.canAccessAvailabilityPoll(eventPoll, CREATOR)).resolves.toBe(false);
  });

  it("allows an event poll for the host, a squadmate of the event, and an RSVP", async () => {
    mockEvent({
      id: "event-1",
      hostId: "host-id",
      squadId: "squad-1",
      rsvps: { [OUTSIDER]: "going" },
    });
    mockMembership([MEMBER]);

    await expect(storage.canAccessAvailabilityPoll(eventPoll, "host-id")).resolves.toBe(true);
    await expect(storage.canAccessAvailabilityPoll(eventPoll, MEMBER)).resolves.toBe(true);
    // RSVP'd, even though not in the squad.
    await expect(storage.canAccessAvailabilityPoll(eventPoll, OUTSIDER)).resolves.toBe(true);
  });

  it("denies someone whose only RSVP is a decline", async () => {
    // Access came from "has a key in event.rsvps", so explicitly bailing on a
    // plan still granted permanent read access to the squad's availability.
    // Only an ACTIVE status ("going" / "maybe") counts.
    mockMembership([]);
    mockEvent({
      id: "event-1",
      hostId: "host-id",
      squadId: null,
      rsvps: { [OUTSIDER]: "notgoing" },
    });

    await expect(storage.canAccessAvailabilityPoll(eventPoll, OUTSIDER)).resolves.toBe(false);
  });

  it("allows a 'maybe' RSVP — undecided still counts as taking part", async () => {
    mockMembership([]);
    mockEvent({
      id: "event-1",
      hostId: "host-id",
      squadId: null,
      rsvps: { [OUTSIDER]: "maybe" },
    });

    await expect(storage.canAccessAvailabilityPoll(eventPoll, OUTSIDER)).resolves.toBe(true);
  });

  it("denies a scoped poll whose linked event has been deleted", async () => {
    mockMembership([]);
    mockEvent(null);

    await expect(storage.canAccessAvailabilityPoll(eventPoll, CREATOR)).resolves.toBe(false);
  });
});

describe("canAccessAvailabilityPoll — ad-hoc polls keep creator + participant access", () => {
  it("allows the creator of an ad-hoc poll (no membership exists to evaluate)", async () => {
    const memberSpy = mockMembership([]);

    await expect(storage.canAccessAvailabilityPoll(adhocPoll, CREATOR)).resolves.toBe(true);
    // No scope means no membership lookup at all.
    expect(memberSpy).not.toHaveBeenCalled();
  });

  it("allows someone on the ad-hoc participant roster", async () => {
    await expect(storage.canAccessAvailabilityPoll(adhocPoll, MEMBER)).resolves.toBe(true);
  });

  it("stays open-by-UUID for ad-hoc invite-link sharing", async () => {
    // Ad-hoc polls are shared by link; the UUID is the access token. This is the
    // documented behaviour the scoped-poll tightening must NOT regress.
    await expect(storage.canAccessAvailabilityPoll(adhocPoll, OUTSIDER)).resolves.toBe(true);
  });

  it("does not consult the event lookup for an ad-hoc poll", async () => {
    const eventSpy = mockEvent(null);

    await expect(storage.canAccessAvailabilityPoll(adhocPoll, CREATOR)).resolves.toBe(true);
    expect(eventSpy).not.toHaveBeenCalled();
  });
});
