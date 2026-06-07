/**
 * One-time backfill: generate invite codes for squads that have none.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run backfill-squad-invite-codes
 *
 * Safe to re-run — it only touches rows where invite_code IS NULL.
 */

import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  const client = await pool.connect();
  try {
    const countResult = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM squads WHERE invite_code IS NULL",
    );
    const missing = parseInt(countResult.rows[0].count, 10);

    if (missing === 0) {
      console.log("All squads already have invite codes. Nothing to do.");
      return;
    }

    console.log(`Found ${missing} squad(s) missing an invite code. Backfilling...`);

    const updateResult = await client.query(
      "UPDATE squads SET invite_code = upper(encode(gen_random_bytes(5), 'hex')) WHERE invite_code IS NULL",
    );

    console.log(`Done. Updated ${updateResult.rowCount} squad(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
