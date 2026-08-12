/**
 * One-time backfill: stamp `users.squadz_plus_tier` for existing entitled users.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill-squadz-plus-tier         # dry run
 *   pnpm --filter @workspace/scripts run backfill-squadz-plus-tier --apply # write
 *
 * Why this is needed
 * ------------------
 * `squadz_plus_tier` records WHICH tier an entitlement was bought at, so the
 * founding badge renders without a RevenueCat round-trip. It was added nullable
 * with no default, on the theory that the next webhook or /iap/sync would stamp
 * it. Two things broke that: the product-id constants matched neither store (so
 * every purchase resolved to an unknown product and wrote NO tier), and a user
 * who never renews may not produce another event for a year. Existing
 * subscribers were left indefinitely at NULL and rendered as standard.
 *
 * Tier resolution (read-only against the founding ledger)
 * ------------------------------------------------------
 *   founding — the user's Stripe subscription appears in
 *              founding_member_redemptions, or their completed Stripe checkout
 *              session carries metadata tier='founding'.
 *   standard — entitled, but nothing links them to a redeemed founding spot.
 *   NULL     — not entitled. Left untouched: a tier is provenance for an
 *              entitlement, and inventing one for a free user would surface a
 *              founding badge on an account that never paid.
 *
 * Rows that already have a tier are never overwritten — a stamped value came
 * from a real purchase event and outranks anything inferred here.
 *
 * Known limitation (deliberate): the RevenueCat side of the ledger is keyed by
 * `rc:<original_transaction_id>`, which is not stored on the user row, so a
 * founding purchase made through mobile IAP cannot be attributed from the
 * ledger alone. Those users are backfilled as `standard` and corrected to
 * `founding` by their next webhook or /iap/sync now that product mapping is
 * fixed. This script NEVER writes to the ledger or the founding counter.
 */

import { pool } from "@workspace/db";

const APPLY = process.argv.includes("--apply");

type TierRow = { is_squadz_plus: boolean; squadz_plus_tier: string | null; n: number };

async function reportDistribution(label: string): Promise<void> {
  const { rows } = await pool.query<TierRow>(`
    SELECT is_squadz_plus, squadz_plus_tier, count(*)::int AS n
    FROM users
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log(`\n${label}`);
  for (const r of rows) {
    console.log(
      `  entitled=${r.is_squadz_plus} tier=${r.squadz_plus_tier ?? "NULL"} → ${r.n}`,
    );
  }
}

/**
 * Users whose founding purchase is provable from the ledger / Stripe records.
 * `stripe.checkout_sessions` is synced by stripe-replit-sync and may be absent
 * in a fresh environment, so its absence degrades to "ledger only" rather than
 * failing the backfill.
 */
async function foundingUserIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const viaLedger = await pool.query<{ id: string }>(`
    SELECT u.id
    FROM users u
    JOIN founding_member_redemptions r ON r.subscription_id = u.stripe_subscription_id
    WHERE u.is_squadz_plus = true
  `);
  for (const row of viaLedger.rows) ids.add(row.id);

  try {
    const viaStripe = await pool.query<{ id: string }>(`
      SELECT u.id
      FROM users u
      JOIN stripe.checkout_sessions cs
        ON cs.subscription = u.stripe_subscription_id
       OR cs.customer = u.stripe_customer_id
      WHERE u.is_squadz_plus = true
        AND cs.metadata->>'tier' = 'founding'
    `);
    for (const row of viaStripe.rows) ids.add(row.id);
  } catch (err) {
    console.log(
      `  (stripe.checkout_sessions unavailable — using the ledger only: ${
        (err as Error).message
      })`,
    );
  }

  return ids;
}

async function main(): Promise<void> {
  console.log(APPLY ? "Mode: APPLY (writing)" : "Mode: DRY RUN (no writes; pass --apply)");
  await reportDistribution("Before:");

  const { rows: pending } = await pool.query<{ id: string }>(`
    SELECT id FROM users
    WHERE is_squadz_plus = true AND squadz_plus_tier IS NULL
  `);
  const founding = await foundingUserIds();

  const toFounding = pending.filter((u) => founding.has(u.id)).map((u) => u.id);
  const toStandard = pending.filter((u) => !founding.has(u.id)).map((u) => u.id);

  console.log(
    `\nEntitled users with no tier: ${pending.length}` +
      `\n  → founding: ${toFounding.length}` +
      `\n  → standard: ${toStandard.length}`,
  );

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply to commit.");
    await pool.end();
    return;
  }

  // One statement per tier, both re-checking `squadz_plus_tier IS NULL` so a
  // webhook landing mid-run keeps its (authoritative) value.
  let updatedFounding = 0;
  if (toFounding.length > 0) {
    const res = await pool.query(
      `UPDATE users SET squadz_plus_tier = 'founding'
       WHERE id = ANY($1::text[]) AND is_squadz_plus = true AND squadz_plus_tier IS NULL`,
      [toFounding],
    );
    updatedFounding = res.rowCount ?? 0;
  }
  let updatedStandard = 0;
  if (toStandard.length > 0) {
    const res = await pool.query(
      `UPDATE users SET squadz_plus_tier = 'standard'
       WHERE id = ANY($1::text[]) AND is_squadz_plus = true AND squadz_plus_tier IS NULL`,
      [toStandard],
    );
    updatedStandard = res.rowCount ?? 0;
  }

  console.log(
    `\nUpdated ${updatedFounding + updatedStandard} rows ` +
      `(founding: ${updatedFounding}, standard: ${updatedStandard}).`,
  );
  await reportDistribution("After:");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
