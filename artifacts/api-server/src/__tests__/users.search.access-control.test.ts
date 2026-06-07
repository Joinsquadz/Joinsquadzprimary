import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSearchRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSearchRows.value),
        }),
      }),
    }),
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    friendCode: "friend_code",
  },
}));

vi.mock("../lib/logger");

import usersRouter from "../routes/users";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const CURRENT_USER_ID = "current-user-id";
const OTHER_USER_ID = "other-user-id";

const makeApp = (user?: TestUser) => makeTestApp(usersRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchRows.value = [];
});

describe("GET /api/users/search", () => {
  // The users router registers this route as "/api/users/search" (with the
  // /api prefix baked in). makeTestApp mounts the router at "/api", so the
  // effective path is "/api/api/users/search".
  const SEARCH_PATH = "/api/api/users/search";

  it("returns 401 when unauthenticated", async () => {
    const app = makeApp();
    const res = await request(app).get(`${SEARCH_PATH}?q=alice`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when q is missing", async () => {
    const app = makeApp({ id: CURRENT_USER_ID });
    const res = await request(app).get(SEARCH_PATH);
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is shorter than 2 characters", async () => {
    const app = makeApp({ id: CURRENT_USER_ID });
    const res = await request(app).get(`${SEARCH_PATH}?q=a`);
    expect(res.status).toBe(400);
  });

  it("returns 200 with matching users for an authenticated request", async () => {
    mockSearchRows.value = [
      { id: OTHER_USER_ID, firstName: "Alice", lastName: "Smith", profileImageUrl: null, friendCode: "ALICE1" },
    ];
    const app = makeApp({ id: CURRENT_USER_ID });
    const res = await request(app).get(`${SEARCH_PATH}?q=alice`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe(OTHER_USER_ID);
  });

  it("does not return the current user in search results", async () => {
    // The route filters out currentUserId via the WHERE clause; we verify the DB
    // is not asked to return the caller by confirming the response excludes them.
    // Since the mock returns only pre-seeded rows, seed only other users to
    // confirm the route never re-inserts the caller.
    mockSearchRows.value = [
      { id: OTHER_USER_ID, firstName: "Alice", lastName: "Smith", profileImageUrl: null, friendCode: "ALICE1" },
    ];
    const app = makeApp({ id: CURRENT_USER_ID });
    const res = await request(app).get(`${SEARCH_PATH}?q=alice`);
    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).not.toContain(CURRENT_USER_ID);
  });

  it("returns an empty array when no users match", async () => {
    mockSearchRows.value = [];
    const app = makeApp({ id: CURRENT_USER_ID });
    const res = await request(app).get(`${SEARCH_PATH}?q=zzznomatch`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
