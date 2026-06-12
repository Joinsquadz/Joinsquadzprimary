/**
 * One-time backfill: seed the event_creations ledger from existing events.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill-event-creations
 *
 * The free-tier event cap counts rows in the append-only event_creations
 * ledger over a rolling 12-month window. Existing events created before the
 * ledger existed have no ledger row, so without this backfill every user would
 * get a free reset of their event count. This inserts one ledger row per
 * existing event (preserving the original host and created_at) so historical
 * usage is honored.
 *
 * Safe to re-run — it only inserts rows for events that have no ledger row yet.
 */

import { pool } from "@workspace/db";

async function main() {
  const before = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM event_creations",
  );
  const result = await pool.query(
    `INSERT INTO event_creations (user_id, event_id, created_at)
     SELECT host_id, id, created_at FROM events
     WHERE host_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM event_creations ec WHERE ec.event_id = events.id
       )`,
  );
  const after = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM event_creations",
  );

  const beforeCount = before.rows[0]?.c ?? 0;
  const afterCount = after.rows[0]?.c ?? 0;
  console.log(
    `event_creations ledger: ${beforeCount} -> ${afterCount} (inserted ${
      result.rowCount ?? afterCount - beforeCount
    })`,
  );
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error("Backfill failed:", err);
    await pool.end();
    process.exit(1);
  });
