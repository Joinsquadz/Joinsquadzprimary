import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response } from "express";

const mockSession = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

const mockOidcUser = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}));

const mockRefreshTokenGrant = vi.hoisted(() => vi.fn());
const mockRefreshLocks = vi.hoisted(() => new Map<string, Promise<unknown>>());
const mockRefreshExecutor = vi.hoisted(() => ({ kind: "refresh-tx" }));

vi.mock("openid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("openid-client")>()),
  refreshTokenGrant: mockRefreshTokenGrant,
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
  deleteSession: vi.fn(async (sid: string) => {
    if ((mockSession.value as { sid?: string } | null)?.sid === sid) {
      mockSession.value = null;
    }
  }),
  getOidcConfig: vi.fn(async () => ({})),
  updateSession: vi.fn(async (_sid: string, session: Record<string, unknown>) => {
    mockSession.value = { sid: _sid, ...session };
  }),
  withSessionRefreshLock: async <T>(
    sid: string,
    action: (executor: unknown) => Promise<T>,
  ) => {
    const previous = mockRefreshLocks.get(sid) ?? Promise.resolve();
    const current = previous.then(
      () => action(mockRefreshExecutor),
      () => action(mockRefreshExecutor),
    );
    mockRefreshLocks.set(sid, current);
    try {
      return await current;
    } finally {
      if (mockRefreshLocks.get(sid) === current) mockRefreshLocks.delete(sid);
    }
  },
}));

// `vi.mock` is hoisted above these imports, so the static imports below still
// resolve against the mocked `../lib/auth`. Importing the middleware here at
// collection time — instead of via `vi.resetModules()` + `await import(...)`
// inside `makeApp` — keeps the one-time, heavy transform of the middleware
// dependency graph (real `openid-client`) out of the timed test/hook window,
// which otherwise flakes under parallel CPU/transform contention. The mocks
// read hoisted refs dynamically per request, so no per-test module reset is
// needed for the values to stay fresh.
import { authMiddleware } from "../middlewares/authMiddleware";
import { clearSession, deleteSession, updateSession } from "../lib/auth";

function makeApp() {
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
    mockRefreshTokenGrant.mockReset();
    mockRefreshLocks.clear();
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
    mockOidcUser.value = null;

    const app = await makeApp();
    await request(app)
      .get("/test")
      .set("Authorization", "Bearer unknown-session");

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("C9 — clears session and returns unauthenticated when expires_at is in the past and no refresh_token", async () => {
    // Session exists but is expired; no refresh_token means it cannot be renewed.
    // The middleware must clear the session cookie and not set req.user.
    mockSession.value = {
      sid: "expired-session",
      user: {
        id: "user-expired",
        email: "expired@test.com",
        firstName: "Old",
        lastName: "Token",
        profileImageUrl: null,
      },
      access_token: "stale-token",
      expires_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      // No refresh_token — cannot silently renew.
    };

    const app = await makeApp();
    const res = await request(app)
      .get("/test")
      .set("Authorization", "Bearer expired-session");

    // Session expired → user is not authenticated.
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
    // clearSession must be called so the stale cookie is cleared.
    expect(clearSession).toHaveBeenCalled();
  });

  it("rotates and persists OIDC tokens before authenticating an expired session", async () => {
    const session = {
      sid: "expired-refreshable-session",
      user: {
        id: "user-refresh",
        email: "refresh@test.com",
        firstName: "Refresh",
        lastName: "User",
        profileImageUrl: null,
      },
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    mockSession.value = session;
    mockRefreshTokenGrant.mockResolvedValue({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expiresIn: () => 3600,
    });

    const res = await request(makeApp())
      .get("/test")
      .set("Authorization", "Bearer expired-refreshable-session");

    expect(res.body.user?.id).toBe("user-refresh");
    expect(updateSession).toHaveBeenCalledWith(
      "expired-refreshable-session",
      expect.objectContaining({
        access_token: "new-access",
        refresh_token: "new-refresh",
      }),
      mockRefreshExecutor,
    );
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("preserves an expired OIDC session when refresh fails transiently", async () => {
    mockSession.value = {
      sid: "transient-refresh-session",
      user: {
        id: "user-transient",
        email: "transient@test.com",
        firstName: "Transient",
        lastName: "User",
        profileImageUrl: null,
      },
      access_token: "old-access",
      refresh_token: "still-valid-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    mockRefreshTokenGrant.mockRejectedValue(new TypeError("network unavailable"));

    const res = await request(makeApp())
      .get("/test")
      .set("Authorization", "Bearer transient-refresh-session");

    expect(res.body.user?.id).toBe("user-transient");
    expect(clearSession).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("clears an expired OIDC session after a definitive refresh rejection", async () => {
    mockSession.value = {
      sid: "revoked-refresh-session",
      user: {
        id: "user-revoked",
        email: "revoked@test.com",
        firstName: "Revoked",
        lastName: "User",
        profileImageUrl: null,
      },
      access_token: "old-access",
      refresh_token: "revoked-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    mockRefreshTokenGrant.mockRejectedValue(
      Object.assign(new Error("invalid grant"), {
        name: "ResponseBodyError",
        error: "invalid_grant",
      }),
    );

    const res = await request(makeApp())
      .get("/test")
      .set("Authorization", "Bearer revoked-refresh-session");

    expect(res.body.user).toBeNull();
    expect(clearSession).toHaveBeenCalled();
    expect(deleteSession).toHaveBeenCalledWith(
      "revoked-refresh-session",
      mockRefreshExecutor,
    );
  });

  it("serializes concurrent OIDC refreshes so one rotated token serves every request", async () => {
    mockSession.value = {
      sid: "concurrent-refresh-session",
      user: {
        id: "user-concurrent",
        email: "concurrent@test.com",
        firstName: "Concurrent",
        lastName: "User",
        profileImageUrl: null,
      },
      access_token: "old-access",
      refresh_token: "old-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    let release!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockRefreshTokenGrant.mockImplementation(async () => {
      await exchangeGate;
      return {
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expiresIn: () => 3600,
      };
    });

    const app = makeApp();
    const first = request(app)
      .get("/test")
      .set("Authorization", "Bearer concurrent-refresh-session");
    const second = request(app)
      .get("/test")
      .set("Authorization", "Bearer concurrent-refresh-session");
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [firstRes, secondRes] = await Promise.all([first, second]);

    expect(firstRes.body.user?.id).toBe("user-concurrent");
    expect(secondRes.body.user?.id).toBe("user-concurrent");
    expect(mockRefreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(clearSession).not.toHaveBeenCalled();
  });

  it("serializes definitive rejection so concurrent requests submit the revoked token once", async () => {
    mockSession.value = {
      sid: "concurrent-revoked-session",
      user: {
        id: "user-concurrent-revoked",
        email: "concurrent-revoked@test.com",
        firstName: "Concurrent",
        lastName: "Revoked",
        profileImageUrl: null,
      },
      access_token: "old-access",
      refresh_token: "revoked-refresh",
      expires_at: Math.floor(Date.now() / 1000) - 60,
    };
    let release!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockRefreshTokenGrant.mockImplementation(async () => {
      await exchangeGate;
      throw Object.assign(new Error("invalid grant"), {
        name: "ResponseBodyError",
        error: "invalid_grant",
      });
    });

    const app = makeApp();
    const first = request(app)
      .get("/test")
      .set("Authorization", "Bearer concurrent-revoked-session");
    const second = request(app)
      .get("/test")
      .set("Authorization", "Bearer concurrent-revoked-session");
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [firstRes, secondRes] = await Promise.all([first, second]);

    expect(firstRes.body.user).toBeNull();
    expect(secondRes.body.user).toBeNull();
    expect(mockRefreshTokenGrant).toHaveBeenCalledTimes(1);
    expect(deleteSession).toHaveBeenCalledTimes(1);
  });
});
