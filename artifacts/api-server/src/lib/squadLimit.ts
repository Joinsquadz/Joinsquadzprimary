import { sql } from "drizzle-orm";
import { db, squadMemberHistoryTable } from "@workspace/db";
import { storage } from "../storage";
import { resolveProStatus } from "./proStatus";

export const FREE_SQUAD_LIMIT = 3;

type SquadExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * How many squad slots a user has consumed.
 *
 * Counted from the APPEND-ONLY `squad_member_history` ledger, not from live
 * `squads.member_ids`. Membership is a slot you spend, not a seat you rent:
 * counting live membership let a free user cycle join → leave → join forever
 * and never hit the cap. History rows are written once per (squad, user) and
 * never deleted, so leaving does not refund the slot.
 *
 * Rows for squads that no longer exist still count — the slot was spent.
 */
export async function countSquadSlotsUsed(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(squadMemberHistoryTable)
    .where(sql`${squadMemberHistoryTable.userId} = ${userId}`);
  return row?.count ?? 0;
}

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
  /**
   * Resolves the squad id whose history row should be written IN THE SAME
   * transaction as the membership write, given the action's result. Return
   * null to skip (e.g. the update matched 0 rows because they were already a
   * member).
   *
   * This must not be a fire-and-forget insert after the fact: the ledger is
   * what the cap counts, so a write that lands while its history row is lost
   * hands the user a free extra slot forever. Same tx = both or neither.
   */
  historySquadId?: (value: T) => string | null | undefined,
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
      // Counted from the append-only history ledger (see countSquadSlotsUsed):
      // leaving a squad must not hand the slot back.
      const [row] = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(squadMemberHistoryTable)
        .where(sql`${squadMemberHistoryTable.userId} = ${userId}`);
      if ((row?.count ?? 0) >= FREE_SQUAD_LIMIT) return { ok: false };
    }
    const value = await action(executor);
    // Ledger write shares the action's transaction: the cap counts these rows,
    // so the membership write and its history row must commit together.
    const squadId = historySquadId?.(value);
    if (squadId) {
      await executor
        .insert(squadMemberHistoryTable)
        .values({ squadId, userId })
        .onConflictDoNothing();
    }
    return { ok: true, value };
  };

  if (typeof db.transaction === "function") {
    return db.transaction(async (tx) => run(tx, true));
  }
  return run(db, false);
}
