import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db, eventCreationsTable, eventsTable } from "@workspace/db";
import { storage } from "../storage";
import { resolveProStatus } from "./proStatus";

/**
 * Free-tier plan cap: events and trips COMBINED, created or joined, within a
 * rolling 12-month window. Counted off the append-only `event_creations`
 * ledger so neither deleting a plan nor leaving one refunds the slot.
 */
export const FREE_PLAN_LIMIT = 3;
export const PLAN_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

export const PLAN_LIMIT_MESSAGE =
  `Free plan is limited to ${FREE_PLAN_LIMIT} plans (events and trips combined) in a 12-month window. ` +
  `Upgrade to SquadZ+ for unlimited plans.`;

export type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/**
 * "Orphaned quick-cancel" exclusion: a plan cancelled within an hour of its
 * ledger row, with no invites and no RSVPs, is a pure mis-tap and must not
 * burn a slot. NULL from the LEFT JOIN (the plan row is gone) stays counted.
 */
function orphanFilter() {
  const quickCancelCutoff = new Date(Date.now() - 60 * 60 * 1000);
  return sql`NOT (
    ${eventsTable.cancelled} IS TRUE
    AND ${eventCreationsTable.createdAt} >= ${quickCancelCutoff}
    AND ${eventsTable.invitedUserIds} = '[]'::jsonb
    AND ${eventsTable.rsvps} = '{}'::jsonb
  )`;
}

function windowFilter(userId: string) {
  return and(
    eq(eventCreationsTable.userId, userId),
    gte(eventCreationsTable.createdAt, new Date(Date.now() - PLAN_WINDOW_MS)),
    orphanFilter(),
  );
}

/** Slots consumed by `userId` inside the rolling window. */
export async function countPlanSlotsUsed(executor: Executor, userId: string): Promise<number> {
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(eventCreationsTable)
    .leftJoin(eventsTable, eq(eventCreationsTable.eventId, eventsTable.id))
    .where(windowFilter(userId));
  return row?.count ?? 0;
}

/** ISO timestamp when the oldest counted slot ages out, or null if none. */
export async function nextPlanSlotAvailableAt(
  executor: Executor,
  userId: string,
): Promise<string | null> {
  const [oldest] = await executor
    .select({ createdAt: eventCreationsTable.createdAt })
    .from(eventCreationsTable)
    .leftJoin(eventsTable, eq(eventCreationsTable.eventId, eventsTable.id))
    .where(windowFilter(userId))
    .orderBy(asc(eventCreationsTable.createdAt))
    .limit(1);
  if (!oldest?.createdAt) return null;
  return new Date(new Date(oldest.createdAt).getTime() + PLAN_WINDOW_MS).toISOString();
}

export type PlanSlotDenied = {
  ok: false;
  count: number;
  limit: number;
  nextSlotAvailableAt: string | null;
};

/**
 * Runs a plan-JOINING write (invite accept, RSVP "going", invite-code join)
 * while atomically consuming one free-tier plan slot. Creation has its own
 * inline claim inside the create transaction; this is the join-side twin.
 *
 * The ledger row and the participation write MUST commit together. Claiming in
 * its own transaction and then writing was a real bug: a failed RSVP update, a
 * plan deleted mid-flight, or the loser of two simultaneous invite-accepts
 * would each leave an irreversible ledger row for a plan the user never joined,
 * permanently burning one of only three free slots. Both or neither.
 *
 * Idempotent per (user, plan): a slot already recorded for this exact plan is a
 * no-op that must pass even when the user is at (or over) the cap — otherwise
 * re-accepting or re-RSVPing would start failing for grandfathered users.
 *
 * The advisory lock is taken BEFORE the "already claimed?" probe, not after: a
 * concurrent re-claim that probed first would see no row, block on the lock,
 * and then be judged against a count that its own twin had just incremented —
 * rejecting a no-op. Locking first makes the probe read post-serialisation
 * state. The lock is xact-scoped, so it releases at COMMIT.
 */
export async function withPlanSlot<T>(
  userId: string,
  eventId: string,
  action: (executor: Executor) => Promise<T>,
  /**
   * Decides, from the action's result, whether the join actually happened.
   * Return false to run the action without charging a slot — used when the
   * write matched zero rows (plan gone, or a concurrent accept won the race),
   * where charging would bill the user for a plan they did not join.
   */
  shouldCharge?: (value: T) => boolean,
): Promise<{ ok: true; value: T } | PlanSlotDenied> {
  const user = await storage.getUser(userId);
  const isPro = user ? await resolveProStatus(user) : false;

  const insertRow = async (executor: Executor): Promise<void> => {
    await executor
      .insert(eventCreationsTable)
      .values({ userId, eventId, source: "join" })
      .onConflictDoNothing();
  };

  const run = async (
    executor: Executor,
    inTransaction: boolean,
  ): Promise<{ ok: true; value: T } | PlanSlotDenied> => {
    let alreadyClaimed = false;

    if (inTransaction) {
      // Lock first, then probe — see the note above on why the order matters.
      if (!isPro) {
        await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      }
      const [already] = await executor
        .select({ id: eventCreationsTable.id })
        .from(eventCreationsTable)
        .where(
          and(eq(eventCreationsTable.userId, userId), eq(eventCreationsTable.eventId, eventId)),
        )
        .limit(1);
      alreadyClaimed = Boolean(already);

      if (!isPro && !alreadyClaimed) {
        const used = await countPlanSlotsUsed(executor, userId);
        if (used >= FREE_PLAN_LIMIT) {
          // Returning before the action runs means nothing is written at all.
          return {
            ok: false,
            count: used,
            limit: FREE_PLAN_LIMIT,
            nextSlotAvailableAt: await nextPlanSlotAvailableAt(executor, userId),
          };
        }
      }
    }

    const value = await action(executor);
    // A throw from the action propagates and rolls the whole transaction back,
    // taking any ledger row with it.
    if (!alreadyClaimed && (shouldCharge?.(value) ?? true)) {
      await insertRow(executor);
    }
    return { ok: true, value };
  };

  // Unit-test mocks don't model db.transaction; fall back to running the action
  // unenforced there (the cap and its rollback behaviour are covered against a
  // real Postgres in the concurrency suite).
  if (typeof db.transaction !== "function") {
    return run(db, false);
  }
  return db.transaction(async (tx) => run(tx, true));
}

/** The 403 body every plan-cap rejection returns (machine-readable + copy). */
export function planLimitResponse(denied: Omit<PlanSlotDenied, "ok">) {
  return {
    error: PLAN_LIMIT_MESSAGE,
    code: "PLAN_LIMIT",
    requiresPro: true,
    count: denied.count,
    limit: denied.limit,
    nextSlotAvailableAt: denied.nextSlotAvailableAt,
  };
}
