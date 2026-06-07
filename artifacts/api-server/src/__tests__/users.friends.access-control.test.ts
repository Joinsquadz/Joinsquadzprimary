import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// A queue of result sets returned by successive db.select() calls, plus flags
// to assert that writes happened. Each select() consumes the next entry.
const mockDb = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  selectIdx: 0,
  insertCalled: false,
  deleteCalled: false,
}));

vi.mock("@workspace/db", () => {
  const makeBuilder = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.where = () => builder;
    builder.limit = () => Promise.resolve(rows);
    builder.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return builder;
  };
  return {
    db: {
      select: () => {
        const rows = mockDb.selectResults[mockDb.selectIdx++] ?? [];
        return makeBuilder(rows);
      },
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => { mockDb.insertCalled = true; return Promise.resolve(); } }),
      }),
      delete: () => ({ where: () => { mockDb.deleteCalled = true; return Promise.resolve(); } }),
    },
    usersTable: {
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      profileImageUrl: "profile_image_url",
      friendCode: "friend_code",
    },
    friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  };
});

vi.mock("../lib/logger");

import usersRouter from "../routes/users";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const CURRENT_USER_ID = "current-user-id";
const FRIENDS_PATH = "/api/users/friends";

const makeApp = (user?: TestUser) => makeTestApp(usersRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.selectResults = [];
  mockDb.selectIdx = 0;
  mockDb.insertCalled = false;
  mockDb.deleteCalled = false;
});

describe("Friends routes", () => {
  it("GET requires auth", async () => {
    const res = await request(makeApp()).get(FRIENDS_PATH);
    expect(res.status).toBe(401);
  });

  it("POST requires auth", async () => {
    const res = await request(makeApp()).post(FRIENDS_PATH).send({ friendId: "x" });
    expect(res.status).toBe(401);
  });

  it("DELETE requires auth", async () => {
    const res = await request(makeApp()).delete(`${FRIENDS_PATH}/x`);
    expect(res.status).toBe(401);
  });

  it("GET returns [] when the user has no friends", async () => {
    mockDb.selectResults = [[]]; // friendship rows: none
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(FRIENDS_PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET resolves friend ids to user objects", async () => {
    mockDb.selectResults = [
      [{ friendId: "friend-1" }],
      [{ id: "friend-1", firstName: "Ada", lastName: "L", profileImageUrl: null, friendCode: "SQ-1" }],
    ];
    const res = await request(makeApp({ id: CURRENT_USER_ID })).get(FRIENDS_PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "friend-1", firstName: "Ada", lastName: "L", profileImageUrl: null, friendCode: "SQ-1" },
    ]);
  });

  it("POST rejects a missing friendId", async () => {
    const res = await request(makeApp({ id: CURRENT_USER_ID })).post(FRIENDS_PATH).send({});
    expect(res.status).toBe(400);
    expect(mockDb.insertCalled).toBe(false);
  });

  it("POST rejects adding yourself", async () => {
    const res = await request(makeApp({ id: CURRENT_USER_ID }))
      .post(FRIENDS_PATH)
      .send({ friendId: CURRENT_USER_ID });
    expect(res.status).toBe(400);
    expect(mockDb.insertCalled).toBe(false);
  });

  it("POST 404s when the target user does not exist", async () => {
    mockDb.selectResults = [[]]; // target lookup: not found
    const res = await request(makeApp({ id: CURRENT_USER_ID }))
      .post(FRIENDS_PATH)
      .send({ friendId: "ghost" });
    expect(res.status).toBe(404);
    expect(mockDb.insertCalled).toBe(false);
  });

  it("POST inserts both directions for a valid friend", async () => {
    mockDb.selectResults = [[{ id: "friend-1" }]]; // target exists
    const res = await request(makeApp({ id: CURRENT_USER_ID }))
      .post(FRIENDS_PATH)
      .send({ friendId: "friend-1" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDb.insertCalled).toBe(true);
  });

  it("DELETE removes the friendship", async () => {
    const res = await request(makeApp({ id: CURRENT_USER_ID })).delete(`${FRIENDS_PATH}/friend-1`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDb.deleteCalled).toBe(true);
  });
});
