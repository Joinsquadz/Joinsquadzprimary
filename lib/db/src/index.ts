import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDbConfig } from "./connection";

const { Pool } = pg;

const poolWithRawQuery = new Pool(resolveDbConfig());

/**
 * pg-pool replaces a driver error with this wrapper if the connection timeout
 * races the driver's connection callback. The original error is retained as
 * `cause`, but callers otherwise lose PostgreSQL diagnostics such as `code`,
 * `detail`, and the server-provided message.
 *
 * Keep this handling at the shared pool boundary so every consumer receives
 * the authoritative database error without changing pool configuration,
 * timeout behavior, or retry behavior.
 */
function preservePostgresError(error: unknown): unknown {
  if (
    error instanceof Error &&
    error.message === "Connection terminated due to connection timeout" &&
    "cause" in error &&
    error.cause instanceof Error
  ) {
    return error.cause;
  }
  return error;
}

const rawPoolQuery = poolWithRawQuery.query.bind(poolWithRawQuery);

// Pool.query has callback and Promise overloads. Keep both paths intact while
// replacing only pg-pool's timeout wrapper with its underlying driver error.
poolWithRawQuery.query = ((...args: any[]) => {
  const callbackIndex = args.length - 1;
  const callback = args[callbackIndex];

  if (typeof callback === "function") {
    args[callbackIndex] = (error: unknown, ...results: unknown[]) =>
      callback(preservePostgresError(error), ...results);
    return Reflect.apply(rawPoolQuery, poolWithRawQuery, args);
  }

  return Reflect.apply(rawPoolQuery, poolWithRawQuery, args).catch((error: unknown) => {
    throw preservePostgresError(error);
  });
}) as typeof poolWithRawQuery.query;

export const pool = poolWithRawQuery;
export const db = drizzle(pool, { schema });

export { resolveDbConfig } from "./connection";
export * from "./schema";
