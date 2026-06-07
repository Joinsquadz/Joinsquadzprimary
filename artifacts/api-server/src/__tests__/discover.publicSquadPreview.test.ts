import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectResults = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectResults.value),
      }),
    }),
  },
  squadsTable: {
    id: "id",
    isPublic: "is_public",
    memberIds: "member_ids",
    createdAt: "created_at",
  },
  eventsTable: {
    id: "id",
    isPublic: "is_public",
    hostId: "host_id",
    rsvps: "rsvps",
    cancelled: "cancelled",
    createdAt: "created_at",
  },
}));

vi.mock("../lib/logger");

import discoverRouter from "../routes/discover";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const publicSquad = {
  id: "squad-public",
  name: "Open Squad",
  emoji: "🌍",
  color: "#00AAFF",
  memberIds: ["a", "b", "c"],
  isPublic: true,
  createdAt: new Date().toISOString(),
};

const privateSquad = {
  ...publicSquad,
  id: "squad-private",
  name: "Secret Squad",
  isPublic: false,
};

const makeApp = (user?: TestUser) => makeTestApp(discoverRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectResults.value = [];
});

describe("GET /api/discover/squads/:id", () => {
  it("returns public squad metadata without authentication", async () => {
    mockSelectResults.value = [publicSquad];
    const app = makeApp();
    const res = await request(app).get("/api/discover/squads/squad-public");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "squad-public",
      name: "Open Squad",
      emoji: "🌍",
      color: "#00AAFF",
      memberCount: 3,
      isPublic: true,
    });
    // Never leak the raw member id list in the public preview.
    expect(res.body.memberIds).toBeUndefined();
  });

  it("returns 404 when the squad does not exist", async () => {
    mockSelectResults.value = [];
    const app = makeApp();
    const res = await request(app).get("/api/discover/squads/missing");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the squad is private", async () => {
    mockSelectResults.value = [privateSquad];
    const app = makeApp();
    const res = await request(app).get("/api/discover/squads/squad-private");
    expect(res.status).toBe(404);
  });
});
