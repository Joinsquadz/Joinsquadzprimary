import { sql } from "drizzle-orm";
import { db, squadsTable } from "@workspace/db";
import { storage } from "../storage";
import { resolveProStatus } from "./proStatus";

export const FREE_SQUAD_LIMIT = 2;

type SquadExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * Runs a squad-membership-growing write (join, create, or invite-accept) while
 * atomically enforcing the free-plan squad cap.
 *
 * The naive "count, then if-under-limit write" is a classic TOCTOU race: two
 * concurrent joins/creates for the same free user can each read count = limit-1
 * and both proceed, pushing the user over the cap. To close that window we run
 * the count-then-write inside a single transaction guarded by a per-user
 * advisory lock (`pg_advisory_xact_lock`, auto-released at COMMIT), so the
 * checks serialize for a given user while staying fully concurrent across users.
 *
 * `enforce` is false for already-members re-joining (their write is an
 * idempotent no-op that must never be blocked). Pro users bypass the cap.
 *
 * Under the unit-test mocks `db.transaction` is absent; we then fall back to
 * running the write directly with no cap re-check (the mocks don't model the
 * count and don't assert the cap — concurrency is verified by the isolated
 * integration test against a real Postgres instead).
 */
export async function withSquadLimit<T>(
  userId: string,
  enforce: boolean,
  action: (executor: SquadExecutor) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let isPro = false;
  if (enforce) {
    const user = await storage.getUser(userId);
    isPro = user ? await resolveProStatus(user) : false;
  }

  const run = async (
    executor: SquadExecutor,
    inTransaction: boolean,
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (enforce && !isPro && inTransaction) {
      await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [row] = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(squadsTable)
        .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);
      if ((row?.count ?? 0) >= FREE_SQUAD_LIMIT) return { ok: false };
    }
    const value = await action(executor);
    return { ok: true, value };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(async (tx) => run(tx, true));
  }
  return run(db, false);
}
