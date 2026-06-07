import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Queue of result sets returned by successive db.select() calls.
const mockDb = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectIdx: 0,
}));

vi.mock("@workspace/db", () => {
  const makeBuilder = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.where = () => builder;
    builder.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return builder;
  };
  return {
    db: {
      select: () => {
        const rows = mockDb.selectResults[mockDb.selectIdx++] ?? [];
        return makeBuilder(rows);
      },
    },
    squadsTable: { id: "id", memberIds: "member_ids" },
    eventsTable: { squadId: "squad_id", cancelled: "cancelled" },
  };
});

vi.mock("../lib/logger");

import suggestionsRouter from "../routes/suggestions";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const CURRENT_USER_ID = "current-user-id";
const PATH = "/api/suggestions";

const makeApp = (user?: TestUser) => makeTestApp(suggestionsRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.selectResults = [];
  mockDb.selectIdx = 0;
});

describe("GET /api/suggestions", () => {
  it("requires auth", async () => {
    const res = await request(makeApp()).get(PATH);
    expect(res.status).toBe(401);
  });

  it("suggests creating a first squad when the user has none", async () => {
    mockDb.selectResults = [[]]; // squads: none
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(PATH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].action).toEqual({ kind: "create-squad" });
  });

  it("suggests planning for a squad that has no events", async () => {
    mockDb.selectResults = [
      [{ id: "squad-1", name: "Roommates", emoji: "🏠", memberIds: [CURRENT_USER_ID] }],
      [], // events: none
    ];
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(PATH);
    expect(res.status).toBe(200);
    const plan = res.body.find((s: { type: string }) => s.type === "Plan");
    expect(plan).toBeTruthy();
    expect(plan.action).toEqual({ kind: "create-event", squadId: "squad-1", squadName: "Roommates" });
  });

  it("suggests RSVP for an event the user has not responded to", async () => {
    mockDb.selectResults = [
      [{ id: "squad-1", name: "Roommates", emoji: "🏠", memberIds: [CURRENT_USER_ID] }],
      [
        {
          id: "event-1",
          title: "Game night",
          emoji: "🎮",
          date: "Fri 8pm",
          squadId: "squad-1",
          squadName: "Roommates",
          hostId: "someone-else",
          rsvps: {},
        },
      ],
    ];
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(PATH);
    expect(res.status).toBe(200);
    const rsvp = res.body.find((s: { type: string }) => s.type === "RSVP");
    expect(rsvp).toBeTruthy();
    expect(rsvp.action).toEqual({ kind: "open-event", eventId: "event-1" });
  });

  it("does not suggest RSVP for an event the user already responded to", async () => {
    mockDb.selectResults = [
      [{ id: "squad-1", name: "Roommates", emoji: "🏠", memberIds: [CURRENT_USER_ID] }],
      [
        {
          id: "event-1",
          title: "Game night",
          emoji: "🎮",
          date: "Fri 8pm",
          squadId: "squad-1",
          squadName: "Roommates",
          hostId: "someone-else",
          rsvps: { [CURRENT_USER_ID]: "going" },
        },
      ],
    ];
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(PATH);
    expect(res.status).toBe(200);
    const rsvp = res.body.find((s: { type: string }) => s.type === "RSVP");
    expect(rsvp).toBeFalsy();
  });
});
