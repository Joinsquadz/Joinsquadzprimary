export type RefreshResult =
  | { kind: "refreshed"; token: string; refreshToken?: string }
  | { kind: "invalid" }
  | { kind: "transient" };

type RefreshPayload = {
  token?: unknown;
  refreshToken?: unknown;
};

export function classifyRefreshResponse(
  status: number,
  payload: RefreshPayload,
): RefreshResult {
  if (status >= 200 && status < 300) {
    if (typeof payload.token !== "string" || payload.token.length === 0) {
      return { kind: "transient" };
    }
    return {
      kind: "refreshed",
      token: payload.token,
      ...(typeof payload.refreshToken === "string" && payload.refreshToken.length > 0
        ? { refreshToken: payload.refreshToken }
        : {}),
    };
  }

  // A refresh credential rejected by the server is permanently unusable.
  // Timeouts, throttling, and server failures are retryable and must not sign
  // out a user whose session was already confirmed.
  if (
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 425 &&
    status !== 429
  ) {
    return { kind: "invalid" };
  }
  return { kind: "transient" };
}

type RefreshCoordinatorDeps = {
  getRefreshToken: () => string | null;
  loadRefreshToken: () => Promise<string | null>;
  rememberRefreshToken: (refreshToken: string) => void;
  exchange: (refreshToken: string) => Promise<RefreshResult>;
  commitTokens: (
    tokens: { token: string; refreshToken?: string },
    isCurrent: () => boolean,
  ) => Promise<void>;
};

export type SessionRefreshCoordinator = {
  refresh: () => Promise<RefreshResult>;
  reset: () => void;
};

/**
 * Creates one guarded refresh lane for cold start, foreground recovery, and
 * protected-request 401s. Concurrent callers share the same exchange and only
 * continue after rotated credentials have been persisted.
 */
export function createSessionRefreshCoordinator(
  deps: RefreshCoordinatorDeps,
): SessionRefreshCoordinator {
  let inFlight: Promise<RefreshResult> | null = null;
  let generation = 0;
  let pendingTokens: { token: string; refreshToken?: string } | null = null;

  const run = async (startedGeneration: number): Promise<RefreshResult> => {
    if (pendingTokens) {
      const pending = pendingTokens;
      try {
        await deps.commitTokens(
          pending,
          () => generation === startedGeneration,
        );
        if (generation !== startedGeneration) return { kind: "transient" };
        pendingTokens = null;
        return { kind: "refreshed", ...pending };
      } catch {
        return { kind: "transient" };
      }
    }

    let refreshToken = deps.getRefreshToken();
    if (!refreshToken) {
      refreshToken = await deps.loadRefreshToken();
      if (refreshToken && generation === startedGeneration) {
        deps.rememberRefreshToken(refreshToken);
      }
    }
    if (!refreshToken) return { kind: "invalid" };

    let result: RefreshResult;
    try {
      result = await deps.exchange(refreshToken);
    } catch {
      return { kind: "transient" };
    }

    if (result.kind !== "refreshed" || generation !== startedGeneration) {
      return generation === startedGeneration ? result : { kind: "transient" };
    }

    try {
      const rotated = {
        token: result.token,
        refreshToken: result.refreshToken,
      };
      pendingTokens = rotated;
      await deps.commitTokens(
        rotated,
        () => generation === startedGeneration,
      );
      if (generation !== startedGeneration) return { kind: "transient" };
      pendingTokens = null;
      return result;
    } catch {
      // Rotation succeeded remotely but local durability did not. The client
      // keeps the rotated pair in memory, does not retry the protected request,
      // and can try persistence/refresh again without logging the user out.
      return { kind: "transient" };
    }
  };

  return {
    refresh() {
      if (inFlight) return inFlight;
      const startedGeneration = generation;
      const current = run(startedGeneration);
      inFlight = current;
      void current.finally(() => {
        if (inFlight === current) inFlight = null;
      });
      return current;
    },
    reset() {
      generation += 1;
      inFlight = null;
      pendingTokens = null;
    },
  };
}

/**
 * Supabase access tokens are JWTs. Opaque OIDC session ids deliberately return
 * false here because their expiry/refresh lifecycle is owned by the API server.
 */
export function isAccessTokenExpired(
  token: string,
  nowMs = Date.now(),
  skewMs = 30_000,
): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return (
      typeof payload.exp === "number" &&
      payload.exp * 1000 <= nowMs + skewMs
    );
  } catch {
    return false;
  }
}