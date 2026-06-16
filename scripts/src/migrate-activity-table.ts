/**
 * One-time migration: create the `activity` table and add
 * `activity_last_read_at` to users if they don't already exist.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate-activity-table
 *
 * Safe to re-run — all DDL uses IF NOT EXISTS.
 */

import pg from "pg";

const { Pool } = pg;

const raw = (process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? "").trim();

if (!raw) {
  console.error("ERROR: SUPABASE_DB_URL or DATABASE_URL environment variable is required.");
  process.exit(1);
}

// ── Copied from lib/db/src/connection.ts ──────────────────────────────────
// Supabase passwords contain raw special chars that break new URL().
// We parse the connection string manually (last-@ split) so those chars
// are passed verbatim as discrete pg fields, not through a URL encoder.

interface ParsedConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

function firstIndexOfAny(s: string, chars: string[]): number {
  let min = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i !== -1 && (min === -1 || i < min)) min = i;
  }
  return min;
}

function parseManual(rest: string): ParsedConn {
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) throw new Error("Invalid connection string (missing @).");
  const userinfo = rest.slice(0, atIdx);
  const afterAt = rest.slice(atIdx + 1);
  const authEnd = firstIndexOfAny(afterAt, ["/", "?", "#"]);
  const hostPort = authEnd === -1 ? afterAt : afterAt.slice(0, authEnd);
  const remainder = authEnd === -1 ? "" : afterAt.slice(authEnd);
  let path = "";
  let query = "";
  if (remainder) {
    const hashIdx = remainder.indexOf("#");
    const noFrag = hashIdx === -1 ? remainder : remainder.slice(0, hashIdx);
    const qIdx = noFrag.indexOf("?");
    if (qIdx === -1) { path = noFrag; } else { path = noFrag.slice(0, qIdx); query = noFrag.slice(qIdx + 1); }
  }
  const database = path.replace(/^\//, "") || "postgres";
  const userColon = userinfo.indexOf(":");
  const user = userColon === -1 ? userinfo : userinfo.slice(0, userColon);
  const password = userColon === -1 ? "" : userinfo.slice(userColon + 1);
  const hpColon = hostPort.lastIndexOf(":");
  const host = hpColon === -1 ? hostPort : hostPort.slice(0, hpColon);
  let port = 5432;
  if (hpColon !== -1) { port = Number.parseInt(hostPort.slice(hpColon + 1), 10); }
  const sslmode = new URLSearchParams(query).get("sslmode") ?? undefined;
  return { host, port, user, password, database, sslmode };
}

function parseConn(connStr: string) {
  const scheme = connStr.match(/^postgres(?:ql)?:\/\//i);
  if (!scheme) throw new Error("Connection string must start with postgres:// or postgresql://");
  const parsed = parseManual(connStr.slice(scheme[0].length));
  const isSupabase = /supabase\.(co|com)$/i.test(parsed.host);
  const ssl = isSupabase ? { rejectUnauthorized: false } : undefined;
  return { ...parsed, ...(ssl ? { ssl } : {}) };
}
// ─────────────────────────────────────────────────────────────────────────────

const pool = new Pool(parseConn(raw));

async function run() {
  const client = await pool.connect();
  try {
    console.log("Connected to database.");

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS activity_last_read_at TIMESTAMPTZ;
    `);
    console.log("✓ users.activity_last_read_at column ensured.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_id  TEXT NOT NULL,
        actor_id      TEXT NOT NULL,
        type          TEXT NOT NULL,
        subject_type  TEXT,
        subject_id    TEXT,
        meta          JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✓ activity table ensured.");

    await client.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_recipient_created"
        ON activity (recipient_id, created_at);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS "IDX_activity_recipient_actor_subject"
        ON activity (recipient_id, actor_id, type, subject_id);
    `);
    console.log("✓ Indexes ensured.");

    console.log("\nMigration complete ✓");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
