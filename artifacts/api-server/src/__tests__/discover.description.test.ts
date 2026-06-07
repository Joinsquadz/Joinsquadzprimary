import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Discover runs up to three sequential `select()` queries (events, squads,
// creators). A FIFO queue lets each test seed the result for each query in
// order. The chain methods are all chainable and the terminal awaits resolve
// to the shifted result, so both `.limit()`-terminated and `.where()`-awaited
// queries work against the same mock.
const selectResults = vi.hoisted(() => ({ queue: [] as unknown[][] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const result = selectResults.queue.shift() ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(result),
        then: (
          resolve: (v: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  },
  eventsTable: {
    isPublic: "is_public",
    hostId: "host_id",
    rsvps: "rsvps",
    cancelled: "cancelled",
    createdAt: "created_at",
  },
  squadsTable: {
    isPublic: "is_public",
    memberIds: "member_ids",
    createdAt: "created_at",
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
  },
  friendshipsTable: {
    ownerId: "owner_id",
    friendId: "friend_id",
  },
}));

vi.mock("../lib/logger");

import discoverRouter from "../routes/discover";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { STRANGER_ID, CREATOR_ID, makeBaseSquad } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(discoverRouter, user);

beforeEach(() => {
  selectResults.queue = [];
});

describe("GET /api/discover — squad descriptions", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/discover");
    expect(res.status).toBe(401);
  });

  it("includes the description on returned squads", async () => {
    const description = "Public board-game night, all welcome.";
    const publicSquad = makeBaseSquad({
      id: "squad-public",
      isPublic: true,
      description,
    });
    // Order: friends (friendshipsTable), squads, allPublicEvents, creators.
    selectResults.queue = [
      [{ friendId: CREATOR_ID }],
      [publicSquad],
      [],
      [{ id: CREATOR_ID, firstName: "Cre", lastName: "Ator" }],
    ];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/discover");
    expect(res.status).toBe(200);
    expect(res.body.squads).toHaveLength(1);
    expect(res.body.squads[0].description).toBe(description);
    expect(res.body.squads[0].creatorName).toBe("Cre Ator");
  });
});
