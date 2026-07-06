import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Locks in the INTENTIONAL event-access contract established by the July 2026
// audit remediation (the "invisible squad dinner" fix):
//   - A plain squad event is visible to every CURRENT squad member — no RSVP
//     or explicit invite required (before the fix, squadmates got 403 and the
//     event never appeared on the squad screen).
//   - Trips remain live-squad-membership based and IGNORE the rsvps map, so a
//     stale RSVP left over from before a member was removed grants nothing.
//   - Plain events additionally keep the rsvps-map path so invited OUTSIDERS
//     who responded retain access (that path is separate from squad checks).
//   - Strangers (no squad, no invite, no RSVP) are denied both kinds.

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
      }),
    }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    rsvps: "rsvps",
    type: "type",
    squadId: "squad_id",
    version: "version",
    itinerary: "itinerary",
    packing: "packing",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  usersTable: {},
}));

const mockSquad = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn(() => Promise.resolve(mockSquad.value)),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

// Static import below vi.mock — keeps the heavy dependency-graph transform out
// of the timed test window (see .agents/memory/api-server-test-cold-import.md).
import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import {
  HOST_ID,
  MEMBER_ID,
  STRANGER_ID,
  RSVP_USER_ID,
  makeBaseEvent,
} from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const makePlainSquadEvent = (overrides: Record<string, unknown> = {}) =>
  makeBaseEvent({
    type: "event",
    squadId: "squad-1",
    squadName: "Test Squad",
    invitedUserIds: [] as string[],
    version: 0,
    ...overrides,
  });

const SQUAD = { id: "squad-1", memberIds: [HOST_ID, MEMBER_ID] };

beforeEach(() => {
  const event = makePlainSquadEvent();
  mockRows.value = [event];
  mockUpdateRows.value = [event];
  mockSquad.value = SQUAD;
});

describe("GET /api/events/:id — plain squad event visibility", () => {
  it("returns 200 for the host", async () => {
    const app = makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
  });

  it("returns 200 for a CURRENT squad member with no RSVP and no invite (audit fix)", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
  });

  it("returns 200 for a non-member outsider who has an RSVP key (invited outsider keeps access)", async () => {
    const app = makeApp({ id: RSVP_USER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
  });

  it("returns 403 for a stranger (no membership, no invite, no RSVP)", async () => {
    const app = makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(403);
  });

  it("returns 403 for a REMOVED squad member without an RSVP (live membership re-check)", async () => {
    mockSquad.value = { id: "squad-1", memberIds: [HOST_ID] };
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(403);
  });
});

describe("GET /api/events/:id — trip stale-RSVP trap stays closed", () => {
  beforeEach(() => {
    // A trip whose rsvps map still contains a user who was removed from the
    // squad. Membership is the ONLY squad-side path for trips.
    const trip = makePlainSquadEvent({
      type: "trip",
      rsvps: { [RSVP_USER_ID]: "going" },
    });
    mockRows.value = [trip];
    mockSquad.value = { id: "squad-1", memberIds: [HOST_ID, MEMBER_ID] };
  });

  it("returns 200 for a current squad member without an RSVP", async () => {
    const app = makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(200);
  });

  it("returns 403 for a non-member even with a stale RSVP key", async () => {
    const app = makeApp({ id: RSVP_USER_ID });
    const res = await request(app).get("/api/events/evt-1");
    expect(res.status).toBe(403);
  });
});
