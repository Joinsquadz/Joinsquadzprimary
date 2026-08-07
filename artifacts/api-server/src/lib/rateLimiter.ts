/**
 * Shared DB-backed rate limiter.
 *
 * Replaces the per-process in-memory express-rate-limit store so rate-limit
 * state survives server restarts and is consistent across multiple server
 * instances (horizontal scaling). Uses the same atomic upsert pattern as the
 * auth-route limiter: a single INSERT … ON CONFLICT … RETURNING avoids the
 * separate SELECT + UPDATE race condition.
 *
 * Two exports:
 *   - `isKeyRateLimited(key, max, windowMs)` — low-level; useful for tests and
 *     the auth routes that key by IP+bucket.
 *   - `dbApiRateLimiter()` — Express middleware factory for the API-wide limiter
 *     (keyed by user ID when authenticated, falling back to IP).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";

export const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Increment the rate-limit counter for `key` and return whether the request
 * is over the limit. Degrades gracefully on DB error (allows the request).
 */
export async function isKeyRateLimited(
  key: string,
  max: number,
  windowMs = DEFAULT_WINDOW_MS,
): Promise<{ limited: boolean; count: number }> {
  const windowSec = windowMs / 1000;
  try {
    const rows = await db.execute(sql`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) > ${windowSec}
          THEN 1
          ELSE rate_limits.count + 1
        END,
        window_start = CASE
          WHEN EXTRACT(EPOCH FROM (NOW() - rate_limits.window_start)) > ${windowSec}
          THEN NOW()
          ELSE rate_limits.window_start
        END
      RETURNING count
    `);
    const count = Number((rows.rows[0] as { count: unknown } | undefined)?.count ?? 1);
    return { limited: count > max, count };
  } catch (err) {
    logger.warn({ err }, "Rate-limit DB upsert failed; allowing request");
    return { limited: false, count: 0 };
  }
}

/**
 * Express middleware for the API-wide rate limiter.
 *
 * Keyed by authenticated user ID when req.user is populated (authMiddleware
 * runs before this), falling back to IP for anonymous requests. Sets standard
 * RateLimit-* response headers.
 */
export function dbApiRateLimiter(): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const max = Number(process.env.API_RATE_LIMIT_MAX ?? "500");
  const windowMs = DEFAULT_WINDOW_MS;

  return async function dbApiRateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Health-check endpoints are exempt.
    if (req.path === "/healthz" || req.path === "/health") { next(); return; }

    const userId = (req.user as { id?: string } | undefined)?.id;
    const rawIp = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    // Prefix with "api:" so API-wide keys never collide with auth-bucket keys.
    const key = userId ? `api:u:${userId}` : `api:ip:${rawIp}`;

    const { limited, count } = await isKeyRateLimited(key, max, windowMs);

    // Standard RateLimit headers (draft-ietf-httpapi-ratelimit-headers).
    res.setHeader("RateLimit-Limit", max);
    res.setHeader("RateLimit-Remaining", Math.max(0, max - count));
    res.setHeader("RateLimit-Policy", `${max};w=${Math.floor(windowMs / 1000)}`);

    if (limited) {
      res.status(429).json({ error: "Too many requests, please try again later." });
      return;
    }
    next();
  };
}
