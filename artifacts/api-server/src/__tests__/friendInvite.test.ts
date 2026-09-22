import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

const userRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(userRows.value),
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

import friendInviteRouter from "../routes/friendInvite";

const makeApp = () => {
  const app = express();
  app.use("/api", friendInviteRouter);
  return app;
};

describe("GET /api/add/friend/:code", () => {
  it("returns branded unavailable HTML for an invalid browser code", async () => {
    const res = await request(makeApp()).get("/api/add/friend/not-a-code").set("Accept", "text/html");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Friend invite unavailable");
    expect(res.text).not.toContain("Invalid friend code format");
  });

  it("returns JSON for an invalid code when explicitly requested", async () => {
    const res = await request(makeApp())
      .get("/api/add/friend/not-a-code")
      .set("Accept", "application/json");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid friend code format." });
  });

  it("uses the canonical add/friend web fallback", async () => {
    userRows.value = [
      {
        id: "friend-1",
        firstName: "Ari",
        lastName: "Friend",
        profileImageUrl: null,
        friendCode: "SQ-ABC123",
      },
    ];
    const res = await request(makeApp())
      .get("/api/add/friend/SQ-ABC123")
      .set("Accept", "text/html")
      .set("Host", "example.test")
      .set("X-Forwarded-Proto", "https");

    expect(res.status).toBe(200);
    expect(res.text).toContain("https://example.test/add/friend/SQ-ABC123");
    expect(res.text).not.toContain("/mobile/add/friend/");
  });
});