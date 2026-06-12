import { db } from '@workspace/db';
import { foundingMemberCounterTable } from '@workspace/db/schema';
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
 * Atomically claim a checkout tier. If founding spots remain, increments the
 * counter and returns 'founding'; otherwise returns 'standard'. A per-counter
 * advisory xact lock (auto-released at COMMIT) serializes concurrent claims so
 * two callers racing on the last spot can't both be granted 'founding'.
 *
 * Under unit-test mocks `db.transaction` is absent, so we fall back to a direct
 * read (the concurrency guarantee is covered by the real-DB test).
 */
export async function claimCheckoutTier(): Promise<CheckoutTier> {
  const run = async (tx: Executor): Promise<CheckoutTier> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${FOUNDING_LOCK_KEY})`);
    const [row] = await tx
      .select()
      .from(foundingMemberCounterTable)
      .where(eq(foundingMemberCounterTable.id, 1));
    const redeemed = row?.redeemed ?? 0;
    if (redeemed < FOUNDING_MEMBER_LIMIT) {
      await tx
        .update(foundingMemberCounterTable)
        .set({ redeemed: redeemed + 1 })
        .where(eq(foundingMemberCounterTable.id, 1));
      return 'founding';
    }
    return 'standard';
  };

  return typeof db.transaction === 'function' ? db.transaction((tx) => run(tx)) : run(db);
}
