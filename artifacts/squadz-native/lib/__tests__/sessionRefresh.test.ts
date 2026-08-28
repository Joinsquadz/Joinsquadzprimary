import { describe, expect, it, vi } from "vitest";
import {
  classifyRefreshResponse,
  createSessionRefreshCoordinator,
  isAccessTokenExpired,
  type RefreshResult,
} from "../sessionRefresh";

function makeCoordinator(overrides?: {
  memoryRefreshToken?: string | null;
  storedRefreshToken?: string | null;
  exchange?: (refreshToken: string) => Promise<RefreshResult>;
}) {
  let memoryRefreshToken = overrides?.memoryRefreshToken ?? null;
  const commits: Array<{ token: string; refreshToken?: string }> = [];
  const events: string[] = [];
  const exchange = vi.fn(
    overrides?.exchange ??
      (async () => ({
        kind: "refreshed" as const,
        token: "rotated-access",
        refreshToken: "rotated-refresh",
      })),
  );
  const coordinator = createSessionRefreshCoordinator({
    getRefreshToken: () => memoryRefreshToken,
    loadRefreshToken: async () => overrides?.storedRefreshToken ?? null,
    rememberRefreshToken: (value) => {
      memoryRefreshToken = value;
    },
    exchange,
    commitTokens: async (tokens) => {
      events.push("persist");
      commits.push(tokens);
      memoryRefreshToken = tokens.refreshToken ?? memoryRefreshToken;
    },
  });
  return { coordinator, exchange, commits, events, getMemoryToken: () => memoryRefreshToken };
}

describe("refresh response classification", () => {
  it("accepts and exposes a rotated access/refresh pair", () => {
    expect(
      classifyRefreshResponse(200, {
        token: "new-access",
        refreshToken: "new-refresh",
      }),
    ).toEqual({
      kind: "refreshed",
      token: "new-access",
      refreshToken: "new-refresh",
    });
  });

  it("treats a rejected refresh credential as invalid", () => {
    expect(classifyRefreshResponse(401, {})).toEqual({ kind: "invalid" });
    expect(classifyRefreshResponse(400, {})).toEqual({ kind: "invalid" });
  });

  it("treats network-adjacent/server failures and malformed success as transient", () => {
    expect(classifyRefreshResponse(429, {})).toEqual({ kind: "transient" });
    expect(classifyRefreshResponse(503, {})).toEqual({ kind: "transient" });
    expect(classifyRefreshResponse(200, {})).toEqual({ kind: "transient" });
  });
});

describe("session refresh coordinator", () => {
  it("restores a cold-start refresh token, rotates it, and persists before resolving", async () => {
    const { coordinator, exchange, commits, events, getMemoryToken } = makeCoordinator({
      storedRefreshToken: "stored-refresh",
      exchange: async (refreshToken) => {
        events.push(`exchange:${refreshToken}`);
        return {
          kind: "refreshed",
          token: "cold-access",
          refreshToken: "cold-refresh",
        };
      },
    });

    const result = await coordinator.refresh();
    events.push("resolved");

    expect(result).toEqual({
      kind: "refreshed",
      token: "cold-access",
      refreshToken: "cold-refresh",
    });
    expect(exchange).toHaveBeenCalledWith("stored-refresh");
    expect(commits).toEqual([
      { token: "cold-access", refreshToken: "cold-refresh" },
    ]);
    expect(getMemoryToken()).toBe("cold-refresh");
    expect(events).toEqual([
      "exchange:stored-refresh",
      "persist",
      "resolved",
    ]);
  });

  it("reports missing refresh state as definitively invalid", async () => {
    const { coordinator, exchange, commits } = makeCoordinator();

    await expect(coordinator.refresh()).resolves.toEqual({ kind: "invalid" });
    expect(exchange).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
  });

  it("shares one exchange across concurrent protected-request 401s", async () => {
    let release!: (result: RefreshResult) => void;
    const pending = new Promise<RefreshResult>((resolve) => {
      release = resolve;
    });
    const { coordinator, exchange, commits } = makeCoordinator({
      memoryRefreshToken: "current-refresh",
      exchange: async () => pending,
    });

    const first = coordinator.refresh();
    const second = coordinator.refresh();
    const third = coordinator.refresh();
    expect(exchange).toHaveBeenCalledTimes(1);

    release({
      kind: "refreshed",
      token: "one-access",
      refreshToken: "one-refresh",
    });

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { kind: "refreshed", token: "one-access", refreshToken: "one-refresh" },
      { kind: "refreshed", token: "one-access", refreshToken: "one-refresh" },
      { kind: "refreshed", token: "one-access", refreshToken: "one-refresh" },
    ]);
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(commits).toHaveLength(1);
  });

  it("preserves credentials when the refresh exchange fails transiently", async () => {
    const { coordinator, commits, getMemoryToken } = makeCoordinator({
      memoryRefreshToken: "still-valid-refresh",
      exchange: async () => {
        throw new TypeError("network unavailable");
      },
    });

    await expect(coordinator.refresh()).resolves.toEqual({ kind: "transient" });
    expect(commits).toEqual([]);
    expect(getMemoryToken()).toBe("still-valid-refresh");
  });

  it("does not persist anything after a definitive refresh rejection", async () => {
    const { coordinator, commits } = makeCoordinator({
      memoryRefreshToken: "revoked-refresh",
      exchange: async () => ({ kind: "invalid" }),
    });

    await expect(coordinator.refresh()).resolves.toEqual({ kind: "invalid" });
    expect(commits).toEqual([]);
  });

  it("does not publish/report refresh success until rotated-token persistence succeeds", async () => {
    let persistenceAttempts = 0;
    let publishedToken = "old-access";
    const exchange = vi.fn(async () => ({
      kind: "refreshed" as const,
      token: "rotated-access",
      refreshToken: "rotated-refresh",
    }));
    const coordinator = createSessionRefreshCoordinator({
      getRefreshToken: () => "current-refresh",
      loadRefreshToken: async () => null,
      rememberRefreshToken: () => {},
      exchange,
      commitTokens: async ({ token }) => {
        persistenceAttempts += 1;
        if (persistenceAttempts === 1) {
          throw new Error("secure storage unavailable");
        }
        publishedToken = token;
      },
    });

    await expect(coordinator.refresh()).resolves.toEqual({ kind: "transient" });
    expect(publishedToken).toBe("old-access");

    await expect(coordinator.refresh()).resolves.toEqual({
      kind: "refreshed",
      token: "rotated-access",
      refreshToken: "rotated-refresh",
    });
    expect(publishedToken).toBe("rotated-access");
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it("does not publish a refresh that finishes after a logout/reset boundary", async () => {
    let releasePersistence!: () => void;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let publishedToken = "old-access";
    const coordinator = createSessionRefreshCoordinator({
      getRefreshToken: () => "current-refresh",
      loadRefreshToken: async () => null,
      rememberRefreshToken: () => {},
      exchange: async () => ({
        kind: "refreshed",
        token: "stale-rotated-access",
        refreshToken: "stale-rotated-refresh",
      }),
      commitTokens: async ({ token }, isCurrent) => {
        await persistenceGate;
        if (isCurrent()) publishedToken = token;
      },
    });

    const refresh = coordinator.refresh();
    await Promise.resolve();
    coordinator.reset();
    releasePersistence();

    await expect(refresh).resolves.toEqual({ kind: "transient" });
    expect(publishedToken).toBe("old-access");
  });
});

describe("access-token expiry detection", () => {
  const jwtWithExpiry = (exp: number) => {
    const body = btoa(JSON.stringify({ exp }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return `header.${body}.signature`;
  };

  it("detects expired JWTs for foreground refresh", () => {
    expect(isAccessTokenExpired(jwtWithExpiry(100), 101_000, 0)).toBe(true);
  });

  it("leaves live JWTs and opaque server session ids alone", () => {
    expect(isAccessTokenExpired(jwtWithExpiry(200), 100_000, 0)).toBe(false);
    expect(isAccessTokenExpired("opaque-session-id", 100_000, 0)).toBe(false);
  });
});