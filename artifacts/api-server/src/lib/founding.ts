import { db } from '@workspace/db';
import { foundingMemberCounterTable, foundingMemberRedemptionsTable } from '@workspace/db/schema';
import { sql, eq } from 'drizzle-orm';

// Total number of Founding Member spots. Lives here as a constant (not in the
// DB) so the cap is reviewable in code and can't be silently edited in a row.
export const FOUNDING_MEMBER_LIMIT = 500;

// Arbitrary fixed key for the advisory lock that serializes tier claims.
const FOUNDING_LOCK_KEY = 514224771;

export type CheckoutTier = 'founding' | 'standard';

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/** Price id for the Founding Member tier — server-controlled, never trusted from the client. */
export function getFoundingPriceId(): string {
  const id = process.env.STRIPE_FOUNDING_PRICE_ID;
  if (!id) throw new Error('STRIPE_FOUNDING_PRICE_ID is not configured');
  return id;
}

/** Price id for the Standard tier — server-controlled, never trusted from the client. */
export function getStandardPriceId(): string {
  const id = process.env.STRIPE_STANDARD_PRICE_ID;
  if (!id) throw new Error('STRIPE_STANDARD_PRICE_ID is not configured');
  return id;
}

/** Map a tier to its server-configured Stripe price id. */
export function priceIdForTier(tier: CheckoutTier): string {
  return tier === 'founding' ? getFoundingPriceId() : getStandardPriceId();
}

/**
 * Read-only founding availability for public display (landing page, upgrade
 * modal). Never mutates the counter.
 */
export async function getFoundingStatus(): Promise<{
  spotsRemaining: number;
  isFoundingAvailable: boolean;
  limit: number;
}> {
  const [row] = await db
    .select()
    .from(foundingMemberCounterTable)
    .where(eq(foundingMemberCounterTable.id, 1));
  const redeemed = row?.redeemed ?? 0;
  const spotsRemaining = Math.max(0, FOUNDING_MEMBER_LIMIT - redeemed);
  return { spotsRemaining, isFoundingAvailable: spotsRemaining > 0, limit: FOUNDING_MEMBER_LIMIT };
}

/**
 * Decide which tier a NEW checkout should use, WITHOUT consuming a spot. Returns
 * 'founding' while spots remain, else 'standard'. This is intentionally
 * read-only: the founding counter is only incremented when Stripe confirms a
 * real payment (see `redeemFoundingSpot`), so an abandoned checkout never burns
 * a founding spot. Because nothing is claimed here, two people can legitimately
 * be offered the founding price on the last spot at the same time — whoever
 * actually pays is honoured (a tiny, benign overshoot of the displayed cap).
 */
export async function decideCheckoutTier(): Promise<CheckoutTier> {
  const { isFoundingAvailable } = await getFoundingStatus();
  return isFoundingAvailable ? 'founding' : 'standard';
}

/**
 * Consume a founding spot for a PAID subscription, called from the Stripe
 * `checkout.session.completed` webhook. Idempotent per `subscriptionId`: the
 * redemptions ledger row is the dedupe key, so Stripe re-delivering the event
 * (at-least-once delivery / retries) increments the counter at most once per
 * subscription. A per-counter advisory xact lock serializes concurrent
 * increments so the running total stays consistent. Returns true only when this
 * call actually consumed a new spot.
 *
 * Under unit-test mocks `db.transaction` is absent, so we fall back to running
 * the same steps directly (the real concurrency/idempotency guarantee is
 * covered by the real-DB test).
 */
export async function redeemFoundingSpot(subscriptionId: string): Promise<boolean> {
  if (!subscriptionId) return false;

  const run = async (tx: Executor): Promise<boolean> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`);

    const inserted = await tx
      .insert(foundingMemberRedemptionsTable)
      .values({ subscriptionId })
      .onConflictDoNothing()
      .returning({ subscriptionId: foundingMemberRedemptionsTable.subscriptionId });

    // Already redeemed for this subscription — never double-count.
    if (inserted.length === 0) return false;

    // Cap guard INSIDE the advisory lock: the counter can never exceed the
    // limit, even under concurrent redemptions racing for the last spot. If
    // the cap is already reached, roll back the ledger row (so a later free
    // spot — e.g. refund — could still honour this subscription) and report
    // "sold out"; the purchase then proceeds on the standard price path.
    const [counter] = await tx
      .select()
      .from(foundingMemberCounterTable)
      .where(eq(foundingMemberCounterTable.id, 1));
    if ((counter?.redeemed ?? 0) >= FOUNDING_MEMBER_LIMIT) {
      await tx
        .delete(foundingMemberRedemptionsTable)
        .where(eq(foundingMemberRedemptionsTable.subscriptionId, subscriptionId));
      return false;
    }

    await tx
      .insert(foundingMemberCounterTable)
      .values({ id: 1, redeemed: 1 })
      .onConflictDoUpdate({
        target: foundingMemberCounterTable.id,
        set: { redeemed: sql`${foundingMemberCounterTable.redeemed} + 1` },
      });

    return true;
  };

  return typeof db.transaction === 'function' ? db.transaction((tx) => run(tx)) : run(db);
}

/**
 * Reconcile the founding_member_counter with the actual number of rows in
 * founding_member_redemptions. Called once at server startup to:
 *
 *   1. Back-fill the redemptions ledger from stripe.checkout_sessions for any
 *      founding subscriptions that paid while the founding tables were absent
 *      (those webhook calls threw 500 and the tables were never written to).
 *   2. Set the counter to exactly the ledger count so the gate is accurate.
 *
 * The entire reconciliation runs inside a transaction that holds the same
 * advisory lock used by redeemFoundingSpot, so a concurrent webhook cannot
 * observe an intermediate state or have its increment overwritten.
 *
 * Idempotent: safe to call on every boot. If counter == ledger == real
 * redemptions this completes in <1 ms (two SELECTs, no writes).
 */
export async function reconcileFoundingCounter(): Promise<void> {
  const { logger } = await import('./logger');

  const run = async (tx: Executor): Promise<void> => {
    // Hold the same advisory lock as redeemFoundingSpot to serialise with
    // any concurrent webhook delivery that arrives during a rolling restart.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`);

    // --- Step 1: Back-fill the ledger from the Stripe-synced payment record.
    //
    // stripe.checkout_sessions is synced by stripe-replit-sync and carries the
    // tier stamp we wrote into session metadata at checkout creation time.
    // Any session with tier='founding' that completed before these tables
    // existed will have a subscription_id but no redemption row; we insert it
    // now. ON CONFLICT DO NOTHING makes this idempotent on every subsequent
    // boot — rows already in the ledger from normal webhook delivery are
    // untouched.
    //
    // The try/catch ensures graceful degradation: if stripe-replit-sync has
    // not yet seeded the schema (fresh deploy, test environment), we skip the
    // back-fill and reconcile against whatever the ledger already holds.
    try {
      await tx.execute(sql`
        INSERT INTO founding_member_redemptions (subscription_id)
        SELECT cs.subscription
        FROM stripe.checkout_sessions cs
        WHERE cs.metadata->>'tier' = 'founding'
          AND cs.subscription IS NOT NULL
        ON CONFLICT (subscription_id) DO NOTHING
      `);
    } catch (backfillErr) {
      logger.warn(
        { err: backfillErr },
        '[founding] Back-fill from stripe.checkout_sessions failed — ' +
          'reconciling counter against existing ledger only',
      );
    }

    // --- Step 2: Recount and fix the counter from the (now complete) ledger.
    const [countRow] = await tx
      .select({ total: sql<number>`COUNT(*)::integer` })
      .from(foundingMemberRedemptionsTable);
    const actualCount = countRow?.total ?? 0;

    const [counterRow] = await tx
      .select()
      .from(foundingMemberCounterTable)
      .where(eq(foundingMemberCounterTable.id, 1));
    const storedCount = counterRow?.redeemed ?? 0;

    if (actualCount === storedCount) {
      logger.info(
        { redeemed: storedCount },
        '[founding] Counter is accurate — no reconciliation needed',
      );
      return;
    }

    logger.warn(
      { storedCount, actualCount },
      '[founding] Counter drift detected — reconciling founding_member_counter',
    );

    await tx
      .insert(foundingMemberCounterTable)
      .values({ id: 1, redeemed: actualCount })
      .onConflictDoUpdate({
        target: foundingMemberCounterTable.id,
        set: { redeemed: actualCount },
      });

    logger.info(
      { previous: storedCount, corrected: actualCount },
      '[founding] founding_member_counter reconciled',
    );
  };

  return typeof db.transaction === 'function' ? db.transaction((tx) => run(tx)) : run(db);
}
