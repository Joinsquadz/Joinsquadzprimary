import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const storageMock = vi.hoisted(() => ({
  getAvailabilityPoll: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  canAccessAvailabilityPoll: vi.fn(),
  getSquad: vi.fn(),
  getUsers: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));

vi.mock("../lib/logger");

import availabilityRouter from "../routes/availability";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(availabilityRouter, user);

const HOST_ID = "host-user-id";
const MEMBER_A = "member-a-id";
const MEMBER_B = "member-b-id";

const RESPONSE_DATE = new Date("2026-05-01T10:00:00.000Z");

const squadPoll = {
  id: "poll-squad",
  squadId: "squad-1",
  eventId: null,
  createdBy: HOST_ID,
  title: "Squad Availability",
  days: ["Mon", "Tue", "Wed"],
  slots: ["6PM", "7PM", "8PM"],
  updatedAt: null,
  updatedBy: null,
  createdAt: new Date(),
};

const eventPoll = {
  id: "poll-event",
  squadId: null,
  eventId: "event-1",
  createdBy: HOST_ID,
  title: "Event Availability",
  days: ["Sat", "Sun"],
  slots: ["2PM", "3PM"],
  updatedAt: null,
  updatedBy: null,
  createdAt: new Date(),
};

const mockUsers = [
  { id: HOST_ID, firstName: "Alice", lastName: "Host", email: "alice@example.com", profileImageUrl: null },
  { id: MEMBER_A, firstName: "Bob", lastName: "Member", email: "bob@example.com", profileImageUrl: null },
  { id: MEMBER_B, firstName: "Carol", lastName: "Member", email: "carol@example.com", profileImageUrl: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.canAccessAvailabilityPoll.mockResolvedValue(true);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.getUsers.mockResolvedValue([]);
});

describe("members[].respondedAt — squad-scoped poll", () => {
  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(squadPoll);
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: [HOST_ID, MEMBER_A, MEMBER_B],
    });
    storageMock.getUsers.mockResolvedValue(mockUsers);
  });

  it("sets respondedAt to an ISO string for members who have responded", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: HOST_ID, cells: ["Mon-6PM"], updatedAt: RESPONSE_DATE },
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-squad");

    expect(res.status).toBe(200);
    const hostMember = res.body.members.find((m: { id: string }) => m.id === HOST_ID);
    expect(hostMember).toBeDefined();
    expect(hostMember.respondedAt).toBe(RESPONSE_DATE.toISOString());
  });

  it("sets respondedAt to null for members who have never responded", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: HOST_ID, cells: ["Mon-6PM"], updatedAt: RESPONSE_DATE },
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-squad");

    expect(res.status).toBe(200);
    const memberA = res.body.members.find((m: { id: string }) => m.id === MEMBER_A);
    const memberB = res.body.members.find((m: { id: string }) => m.id === MEMBER_B);
    expect(memberA).toBeDefined();
    expect(memberA.respondedAt).toBeNull();
    expect(memberB).toBeDefined();
    expect(memberB.respondedAt).toBeNull();
  });

  it("sets respondedAt correctly for every member regardless of response order", async () => {
    const dateA = new Date("2026-04-20T08:00:00.000Z");
    const dateB = new Date("2026-04-21T09:30:00.000Z");

    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_B, cells: ["Tue-7PM"], updatedAt: dateB },
      { userId: MEMBER_A, cells: ["Mon-6PM", "Tue-8PM"], updatedAt: dateA },
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-squad");

    expect(res.status).toBe(200);
    const memberA = res.body.members.find((m: { id: string }) => m.id === MEMBER_A);
    const memberB = res.body.members.find((m: { id: string }) => m.id === MEMBER_B);
    const host = res.body.members.find((m: { id: string }) => m.id === HOST_ID);

    expect(memberA.respondedAt).toBe(dateA.toISOString());
    expect(memberB.respondedAt).toBe(dateB.toISOString());
    expect(host.respondedAt).toBeNull();
  });

  it("sets respondedAt to null for all members when there are no responses", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-squad");

    expect(res.status).toBe(200);
    expect(res.body.members.length).toBeGreaterThan(0);
    for (const member of res.body.members) {
      expect(member.respondedAt).toBeNull();
    }
  });
});

describe("members[].respondedAt — event-scoped poll", () => {
  beforeEach(() => {
    storageMock.getAvailabilityPoll.mockResolvedValue(eventPoll);
  });

  it("sets respondedAt to an ISO string for respondents in an event-scoped poll", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([
      { userId: MEMBER_A, cells: ["Sat-2PM"], updatedAt: RESPONSE_DATE },
      { userId: MEMBER_B, cells: ["Sun-3PM"], updatedAt: new Date("2026-05-02T12:00:00.000Z") },
    ]);
    storageMock.getUsers.mockResolvedValue([
      mockUsers.find((u) => u.id === MEMBER_A)!,
      mockUsers.find((u) => u.id === MEMBER_B)!,
    ]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-event");

    expect(res.status).toBe(200);
    const memberA = res.body.members.find((m: { id: string }) => m.id === MEMBER_A);
    const memberB = res.body.members.find((m: { id: string }) => m.id === MEMBER_B);

    expect(memberA).toBeDefined();
    expect(memberA.respondedAt).toBe(RESPONSE_DATE.toISOString());
    expect(memberB).toBeDefined();
    expect(memberB.respondedAt).toBe(new Date("2026-05-02T12:00:00.000Z").toISOString());
  });

  it("returns an empty members array when no one has responded to an event-scoped poll", async () => {
    storageMock.getAvailabilityResponses.mockResolvedValue([]);

    const app = await makeApp({ id: HOST_ID });
    const res = await request(app).get("/api/availability/polls/poll-event");

    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([]);
  });
});
