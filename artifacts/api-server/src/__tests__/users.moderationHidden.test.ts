/**
 * #520 — BUG-02 read-side gate: profiles flagged via 3+ reports must be
 * restricted on every profile-surfacing read path, not just flagged in the DB.
 *
 * Verified:
 *  - GET /users/:id/profile with moderationHidden:true → 451 { underReview: true }
 *  - GET /users/:id/profile with moderationHidden:false → 200 (normal)
 *  - GET /users/:id/profile for unknown user → 404 (unaffected)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state ─────────────────────────────────────────────────────────────
const mockSelectQueue = vi.hoisted(() => ({ queue: [] as unknown[][] }));

// ── @workspace/db mock ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const next = (mockSelectQueue.queue.shift() ?? []) as unknown[];
          // Thenable + .limit() so both `await where(...)` and
          // `await where(...).limit(1)` (the block gate) resolve to the row set.
          return Object.assign(Promise.resolve(next), {
            limit: () => Promise.resolve(next),
          });
        },
      }),
    }),
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    friendCode: "friend_code",
    bio: "bio",
    hometown: "hometown",
    birthdate: "birthdate",
    hobbies: "hobbies",
    privateProfile: "private_profile",
    moderationHidden: "moderation_hidden",
    stripeSubscriptionId: "stripe_subscription_id",
    stripeCustomerId: "stripe_customer_id",
  },
  squadsTable: { id: "id", memberIds: "member_ids" },
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  // Profile reads are block-gated in both directions.
  userBlocksTable: { id: "id", blockerId: "blocker_id", blockedId: "blocked_id" },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "target-1", isSquadzPlus: false }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../lib/logger");
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn().mockResolvedValue(false) }));
vi.mock("../lib/activity");
vi.mock("../lib/pushNotifications");

import usersRouter from "../routes/users";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(usersRouter, user);

const REQUESTER = "req-1";
const TARGET    = "target-1";

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: TARGET,
    firstName: "Alex",
    lastName: "Test",
    profileImageUrl: null,
    friendCode: "ALEX11",
    bio: null,
    hometown: null,
    birthdate: null,
    hobbies: null,
    privateProfile: false,
    moderationHidden: false,
    ...overrides,
  };
}

beforeEach(() => { mockSelectQueue.queue = []; });

// ─── GET /users/:id/profile ───────────────────────────────────────────────────

describe("#520: GET /api/users/:id/profile — moderationHidden gate", () => {
  it("returns 200 and profile data when user is not flagged", async () => {
    // Queues: user lookup, sharedSquads, (storage.getUser is mocked separately).
    mockSelectQueue.queue = [[baseUser({ moderationHidden: false })], []];

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TARGET);
    expect(res.body.underReview).toBeUndefined();
  });

  it("returns 451 with underReview:true when a THIRD PARTY views a flagged profile", async () => {
    mockSelectQueue.queue = [[baseUser({ moderationHidden: true })]];

    // REQUESTER !== TARGET — third-party view should be restricted.
    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(451);
    expect(res.body.underReview).toBe(true);
    expect(res.body.error).toMatch(/under review/i);
    // Sensitive profile fields must not be present in a restricted response.
    expect(res.body.bio).toBeUndefined();
    expect(res.body.firstName).toBeUndefined();
  });

  it("returns 200 when the OWNER views their own flagged profile (not blocked by the gate)", async () => {
    // Account owner should always be able to see their own profile so they
    // know it is under review — the 451 gate must exempt targetId === requesterId.
    mockSelectQueue.queue = [[baseUser({ moderationHidden: true })], []];

    // Make the requester the same user as the target.
    const res = await request(makeApp({ id: TARGET }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TARGET);
    // underReview flag should not appear on an owner-access response.
    expect(res.body.underReview).toBeUndefined();
  });

  it("returns 404 when user does not exist (unaffected by BUG-02 fix)", async () => {
    mockSelectQueue.queue = [[]]; // no rows

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/nonexistent-id/profile`);

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp())
      .get(`/api/users/${TARGET}/profile`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/users/:id/profile — private profile and profile fields", () => {
  it("does not expose a private profile to an unrelated authenticated user", async () => {
    // target, block gate, shared squads, friendship
    mockSelectQueue.queue = [[baseUser({ privateProfile: true })], [], [], []];

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PRIVATE_PROFILE");
    expect(res.body.bio).toBeUndefined();
  });

  it("allows a private profile to an accepted friend", async () => {
    mockSelectQueue.queue = [
      [baseUser({ privateProfile: true, birthdate: "2000-01-01", hobbies: ["Hiking", "Cooking"] })],
      [],
      [],
      [{ ownerId: REQUESTER }],
    ];

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.hobbies).toEqual(["Hiking", "Cooking"]);
    expect(res.body.age).toBe(new Date().getUTCFullYear() - 2000);
    expect(res.body.birthdate).toBeUndefined();
  });

  it("allows a private profile to a current shared-squad member", async () => {
    mockSelectQueue.queue = [
      [baseUser({ privateProfile: true })],
      [],
      [{ id: "sq-1", name: "Crew", emoji: "👥", color: "#000000" }],
    ];

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(200);
    expect(res.body.sharedSquads).toHaveLength(1);
  });
});
