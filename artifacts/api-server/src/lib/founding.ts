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
