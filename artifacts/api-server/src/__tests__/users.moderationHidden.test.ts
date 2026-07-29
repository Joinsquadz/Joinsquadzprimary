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
          const next = mockSelectQueue.queue.shift();
          return Promise.resolve(next ?? []);
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
    moderationHidden: "moderation_hidden",
    stripeSubscriptionId: "stripe_subscription_id",
    stripeCustomerId: "stripe_customer_id",
  },
  squadsTable: { id: "id", memberIds: "member_ids" },
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
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

  it("returns 451 with underReview:true when user is flagged (moderationHidden:true)", async () => {
    mockSelectQueue.queue = [[baseUser({ moderationHidden: true })]];

    const res = await request(makeApp({ id: REQUESTER }))
      .get(`/api/users/${TARGET}/profile`);

    expect(res.status).toBe(451);
    expect(res.body.underReview).toBe(true);
    expect(res.body.error).toMatch(/under review/i);
    // Sensitive profile fields must not be present in a restricted response.
    expect(res.body.bio).toBeUndefined();
    expect(res.body.firstName).toBeUndefined();
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
