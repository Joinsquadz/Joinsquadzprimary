// Shared sample data for the API access-control tests. These fixtures were
// previously copy-pasted byte-for-byte across the event/squad access-control
// suites, which meant a change to the event/squad shape had to be mirrored by
// hand in every file (the exact drift the test helpers were created to avoid).
// The factories below return a fresh object on every call so individual tests
// can mutate the result safely without leaking state into other tests; pass
// `overrides` to specialize a fixture (e.g. seeding tasks/polls).

export const HOST_ID = "host-user-id";
export const STRANGER_ID = "stranger-user-id";
export const RSVP_USER_ID = "rsvp-user-id";

export const MEMBER_ID = "member-user-id";
export const SECOND_MEMBER_ID = "second-member-id";
export const CREATOR_ID = "creator-user-id";

export function makeBaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    title: "Test Event",
    emoji: "🎉",
    date: "2026-07-01",
    location: "Somewhere",
    squadId: "",
    squadName: "Personal",
    hostId: HOST_ID,
    description: "",
    inviteCode: "SQ-ABCD",
    cancelled: false,
    budget: null,
    rsvps: { [RSVP_USER_ID]: "going" },
    tasks: [] as unknown[],
    costs: [] as unknown[],
    polls: [] as unknown[],
    messages: [] as unknown[],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeBaseSquad(overrides: Record<string, unknown> = {}) {
  return {
    id: "squad-1",
    name: "Test Squad",
    emoji: "👥",
    color: "#FF5C3A",
    memberIds: [CREATOR_ID, MEMBER_ID, SECOND_MEMBER_ID],
    creatorId: CREATOR_ID,
    inviteCode: "ORIG-CODE",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
