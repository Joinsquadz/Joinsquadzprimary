import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Separate file for GET /api/users/:id/block so this test runs in its own
// module context. When co-located with the larger moderation.test.ts file in
// the 62-file parallel run some workers share a module instance that makes the
// shared mockSelectRows container return stale values for these two tests.

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
  userBlocksTable: {
    blockerId: "blocker_id",
    blockedId: "blocked_id",
  },
  reportsTable: {},
  feedPostsTable: {},
  momentsTable: {},
  photosTable: {},
}));

vi.mock("../storage", () => ({
  storage: { upsertUser: vi.fn().mockResolvedValue({ id: "u1" }) },
}));
vi.mock("../lib/logger");
vi.mock("../services/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import moderationRouter from "../routes/moderation";
import { makeTestApp } from "./helpers/makeTestApp";

const REPORTER_ID = "reporter-user-id";
const TARGET_ID = "target-user-id";

const authedApp = makeTestApp(moderationRouter, { id: REPORTER_ID });
const anonApp = makeTestApp(moderationRouter);

describe("GET /api/users/:id/block — block status check", () => {
  beforeEach(() => {
    mockSelectRows.value = [];
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(anonApp).get(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(401);
  });

  it("returns 200 with blocked=false when no block row exists", async () => {
    mockSelectRows.value = [];
    const res = await request(authedApp).get(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(false);
  });

  it("returns 200 with blocked=true when block row exists", async () => {
    mockSelectRows.value = [{ blockerId: REPORTER_ID, blockedId: TARGET_ID }];
    const res = await request(authedApp).get(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.blocked).toBe(true);
  });
});
