import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockGetPushToken = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getPushToken: mockGetPushToken,
  },
}));

vi.mock("../lib/logger");

import pushTokensRouter from "../routes/pushTokens";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const USER_ID = "test-user-id";
const STORED_TOKEN = "ExponentPushToken[abc123]";

const makeApp = (user?: TestUser) => makeTestApp(pushTokensRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/push-token", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/push-token");
    expect(res.status).toBe(401);
  });

  it("returns the stored token for the authenticated user", async () => {
    mockGetPushToken.mockResolvedValue(STORED_TOKEN);

    const app = makeApp({ id: USER_ID });
    const res = await request(app).get("/api/push-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: STORED_TOKEN });
    expect(mockGetPushToken).toHaveBeenCalledWith(USER_ID);
  });

  it("returns { token: null } when no token is stored for the user", async () => {
    mockGetPushToken.mockResolvedValue(null);

    const app = makeApp({ id: USER_ID });
    const res = await request(app).get("/api/push-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: null });
    expect(mockGetPushToken).toHaveBeenCalledWith(USER_ID);
  });

  it("returns 500 when storage throws", async () => {
    mockGetPushToken.mockRejectedValue(new Error("DB error"));

    const app = makeApp({ id: USER_ID });
    const res = await request(app).get("/api/push-token");

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
