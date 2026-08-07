#!/usr/bin/env node
/**
 * load-tests/cleanup-direct.mjs
 *
 * Removes all test accounts seeded by seed-direct.mjs.
 * Deletes from the sessions table (by SID) and from the users table
 * (by email pattern) directly in the staging database.
 *
 * Usage:
 *   STAGING_DB_URL='postgresql://...' node load-tests/cleanup-direct.mjs
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _require = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
);
const { Pool } = _require("pg");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(__dirname, ".test-accounts.csv");

const DB_URL = process.env.STAGING_DB_URL;
if (!DB_URL) {
  console.error("❌  STAGING_DB_URL is required.");
  process.exit(1);
}
if (!DB_URL.includes("oalnboykhpvghibkxwdd")) {
  console.error("❌  STAGING_DB_URL does not match the staging project. Refusing to clean up.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 10_000,
});

// 1. Delete sessions by SID (if CSV exists).
if (fs.existsSync(CSV)) {
  const lines = fs.readFileSync(CSV, "utf8").split("\n").filter(Boolean);
  const sids = lines.slice(1).map((l) => l.split(",")[0]).filter(Boolean);
  if (sids.length > 0) {
    const result = await pool.query(`DELETE FROM sessions WHERE sid = ANY($1)`, [sids]);
    console.log(`🗑️   Deleted ${result.rowCount} sessions`);
  }
  const archive = CSV.replace(".csv", `.${Date.now()}.used.csv`);
  fs.renameSync(CSV, archive);
  console.log(`📦  CSV archived → ${path.basename(archive)}`);
} else {
  console.log("ℹ️   No .test-accounts.csv found — skipping session cleanup.");
}

// 2. Delete all loadtest users by email pattern (catches any orphans).
const userResult = await pool.query(
  `DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid' RETURNING id`,
);
console.log(`🗑️   Deleted ${userResult.rowCount} users (loadtest.%@loadtest.invalid)\n`);

await pool.end();
console.log("✅  Cleanup complete. Staging DB is clear of test accounts.\n");
