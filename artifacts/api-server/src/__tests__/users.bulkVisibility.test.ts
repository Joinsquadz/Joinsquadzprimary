import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const state = vi.hoisted(() => ({
  blockedIds: [] as string[],
  userRows: [] as unknown[],
  friendRows: [] as unknown[],
  squadRows: [] as unknown[],
  selectIndex: 0,
}));

vi.mock("../lib/blocks", () => ({
  getBlockedAndBlockerIds: vi.fn(async () => state.blockedIds),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ __name: name });
  return {
    db: {
      select: () => {
        const result = [state.userRows, state.friendRows, state.squadRows][state.selectIndex++] ?? [];
        const builder = {
          from: () => builder,
          where: () => Promise.resolve(result),
        };
        return builder;
      },
    },
    usersTable: {
      ...table("users"),
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      profileImageUrl: "profile_image_url",
      privateProfile: "private_profile",
      moderationHidden: "moderation_hidden",
      stripeSubscriptionId: "stripe_subscription_id",
      stripeCustomerId: "stripe_customer_id",
    },
    friendshipsTable: {
      ...table("friendships"),
      ownerId: "owner_id",
      friendId: "friend_id",
    },
    squadsTable: {
      ...table("squads"),
      memberIds: "member_ids",
    },
  };
});

vi.mock("../lib/proStatus", () => ({
  resolveProStatus: vi.fn().mockResolvedValue(false),
}));
vi.mock("../lib/logger");

import usersRouter from "../routes/users";
import { makeTestApp } from "./helpers/makeTestApp";

const REQUESTER = "me";
const app = () => makeTestApp(usersRouter, { id: REQUESTER });

beforeEach(() => {
  state.blockedIds = [];
  state.userRows = [];
  state.friendRows = [];
  state.squadRows = [];
  state.selectIndex = 0;
});

describe("GET /api/users — caller-aware profile summaries", () => {
  it("does not reveal blocked or unauthorized private users, but preserves self/friend/shared-squad visibility", async () => {
    state.blockedIds = ["blocked"];
    state.userRows = [
      { id: REQUESTER, firstName: "Me", lastName: "User", profileImageUrl: "me.jpg", privateProfile: true },
      { id: "blocked", firstName: "Blocked", lastName: "User", profileImageUrl: "blocked.jpg", privateProfile: false },
      { id: "private-stranger", firstName: "Secret", lastName: "Stranger", profileImageUrl: "secret.jpg", privateProfile: true },
      { id: "friend", firstName: "Known", lastName: "Friend", profileImageUrl: "friend.jpg", privateProfile: true },
      { id: "squadmate", firstName: "Known", lastName: "Squadmate", profileImageUrl: "squad.jpg", privateProfile: true },
      { id: "public", firstName: "Public", lastName: "Person", profileImageUrl: "public.jpg", privateProfile: false },
    ];
    state.friendRows = [{ ownerId: REQUESTER, friendId: "friend" }];
    state.squadRows = [{ memberIds: [REQUESTER, "squadmate"] }];

    const res = await request(app()).get(
      "/api/users?ids=" +
        ["me", "blocked", "private-stranger", "friend", "squadmate", "public"].join(","),
    );

    expect(res.status).toBe(200);
    expect(res.body.map((row: { id: string }) => row.id)).toEqual([
      REQUESTER,
      "friend",
      "squadmate",
      "public",
    ]);
    expect(JSON.stringify(res.body)).not.toContain("Blocked");
    expect(JSON.stringify(res.body)).not.toContain("secret.jpg");
  });

  it("requires authentication", async () => {
    const res = await request(makeTestApp(usersRouter)).get("/api/users?ids=someone");
    expect(res.status).toBe(401);
  });
});