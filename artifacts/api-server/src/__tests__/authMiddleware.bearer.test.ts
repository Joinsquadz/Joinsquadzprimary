import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response } from "express";

const mockSession = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

const mockOidcUser = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

vi.mock("../lib/auth", () => ({
  getSessionId: (req: Request) => {
    const auth = req.headers["authorization"];
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return req.cookies?.sid;
  },
  getBearerToken: (req: Request) => {
    const auth = req.headers["authorization"];
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return undefined;
  },
  getSession: vi.fn(async (sid: string) => {
    if (mockSession.value && (mockSession.value as { sid?: string }).sid === sid) {
      return mockSession.value;
    }
    return null;
  }),
  getUserFromAccessToken: vi.fn(async (_token: string) => {
    return mockOidcUser.value;
  }),
  clearSession: vi.fn(async () => {}),
  getOidcConfig: vi.fn(async () => ({})),
  updateSession: vi.fn(async () => {}),
}));

async function makeApp() {
  vi.resetModules();
  const { authMiddleware } = await import("../middlewares/authMiddleware");
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.get("/test", (req: Request, res: Response) => {
    res.json({ user: (req as Request & { user?: unknown }).user ?? null });
  });
  return app;
}

describe("authMiddleware — Bearer token path", () => {
  beforeEach(() => {
    mockSession.value = null;
    mockOidcUser.value = null;
    vi.clearAllMocks();
  });

  it("sets req.user when Bearer token matches a valid session", async () => {
    mockSession.value = {
      sid: "valid-session-id",
      user: { id: "user-1", email: "a@b.com", firstName: "A", lastName: "B", profileImageUrl: null },
      access_token: "at",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    const app = await makeApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer valid-session-id");

    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe("user-1");
  });

  it("falls back to OIDC userinfo when Bearer token is not a session ID", async () => {
    mockOidcUser.value = {
      id: "oidc-user-1",
      email: "oidc@test.com",
      firstName: "OIDC",
      lastName: "User",
      profileImageUrl: null,
    };

    const app = await makeApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer some-oidc-access-token");

    expect(res.status).toBe(200);
    expect(res.body.user?.id).toBe("oidc-user-1");
  });

  it("returns unauthenticated when Bearer token is invalid and OIDC also fails", async () => {
    mockOidcUser.value = null;

    const app = await makeApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it("returns unauthenticated when no Authorization header is present", async () => {
    const app = await makeApp();
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it("does not call clearSession when Bearer token session is not found", async () => {
    const { clearSession } = await import("../lib/auth");
    mockOidcUser.value = null;

    const app = await makeApp();
    await request(app)
      .get("/test")
      .set("Authorization", "Bearer unknown-session");

    expect(clearSession).not.toHaveBeenCalled();
  });
});
