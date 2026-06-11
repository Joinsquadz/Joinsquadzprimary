import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSavePushToken = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    savePushToken: mockSavePushToken,
  },
}));

vi.mock("../lib/logger");

import pushTokensRouter from "../routes/pushTokens";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const USER_ID = "test-user-id";
const VALID_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

const makeApp = (user?: TestUser) => makeTestApp(pushTokensRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/push-token", () => {
  it("returns 401 when the caller is not authenticated", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/push-token")
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(401);
    expect(mockSavePushToken).not.toHaveBeenCalled();
  });

  it("returns 400 when the token field is missing", async () => {
    const app = makeApp({ id: USER_ID });
    const res = await request(app).post("/api/push-token").send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockSavePushToken).not.toHaveBeenCalled();
  });

  it("returns 400 when the token is not a valid Expo push token", async () => {
    const app = makeApp({ id: USER_ID });
    const res = await request(app)
      .post("/api/push-token")
      .send({ token: "not-a-real-expo-token" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockSavePushToken).not.toHaveBeenCalled();
  });

  it("persists a valid token and returns { ok: true }", async () => {
    mockSavePushToken.mockResolvedValue(undefined);

    const app = makeApp({ id: USER_ID });
    const res = await request(app)
      .post("/api/push-token")
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockSavePushToken).toHaveBeenCalledWith(USER_ID, VALID_TOKEN);
  });

  it("returns 500 when storage throws", async () => {
    mockSavePushToken.mockRejectedValue(new Error("DB error"));

    const app = makeApp({ id: USER_ID });
    const res = await request(app)
      .post("/api/push-token")
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
