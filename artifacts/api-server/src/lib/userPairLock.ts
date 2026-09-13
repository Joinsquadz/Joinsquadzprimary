import { sql, type SQL } from "drizzle-orm";

type PairLockExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

/**
 * Lock one unordered pair of users for the duration of the surrounding
 * PostgreSQL transaction. Callers must use this before checking blocks,
 * requests, or friendships and before writing any of those rows.
 */
export async function lockUserPair(
  executor: PairLockExecutor,
  userA: string,
  userB: string,
): Promise<void> {
  const first = userA < userB ? userA : userB;
  const second = userA < userB ? userB : userA;
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${first} || ':' || ${second}))`,
  );
}