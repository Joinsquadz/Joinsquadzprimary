#!/usr/bin/env node
/**
 * load-tests/cleanup-prod.mjs
 *
 * Removes all load-test accounts from the PRODUCTION database.
 * Matches on email LIKE 'loadtest.%@loadtest.invalid'.
 *
 * Usage:
 *   node load-tests/cleanup-prod.mjs
 *
 * Reads SUPABASE_DB_URL from the environment.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = _require("pg");

function parsePostgresUrl(raw) {
  const stripped = raw.replace(/^postgresql?:\/\//, "");
  const lastAt = stripped.lastIndexOf("@");
  const credPart = stripped.slice(0, lastAt);
  const hostPart = stripped.slice(lastAt + 1);
  const colonInCred = credPart.indexOf(":");
  const user = credPart.slice(0, colonInCred);
  const password = credPart.slice(colonInCred + 1);
  const slashInHost = hostPart.indexOf("/");
  const hostPort = hostPart.slice(0, slashInHost);
  const database = hostPart.slice(slashInHost + 1);
  const colonInHP = hostPort.lastIndexOf(":");
  const host = hostPort.slice(0, colonInHP);
  const urlPort = parseInt(hostPort.slice(colonInHP + 1));
  return { user, password, host, urlPort, database };
}

const rawUrl = process.env.SUPABASE_DB_URL;
if (!rawUrl) { console.error("❌  SUPABASE_DB_URL required"); process.exit(1); }
if (rawUrl.includes("oalnboykhpvghibkxwdd")) {
  console.error("❌  Staging URL detected — use cleanup-direct.mjs instead"); process.exit(1);
}

const { user, password, host, urlPort, database } = parsePostgresUrl(rawUrl);
const port = parseInt(process.env.DB_POOLER_PORT ?? String(urlPort));

const pool = new Pool({
  host, port, user, password, database,
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 15_000,
});

// 1. Read SIDs from current CSV to delete sessions exactly (optional belt-and-suspenders)
const csvPath = path.join(__dirname, ".test-accounts.csv");
let sids = [];
if (fs.existsSync(csvPath)) {
  sids = fs.readFileSync(csvPath, "utf8")
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map(l => l.split(",")[0]);
}

if (sids.length > 0) {
  const placeholders = sids.map((_, i) => `$${i + 1}`).join(",");
  const res = await pool.query(`DELETE FROM sessions WHERE sid IN (${placeholders}) RETURNING sid`, sids);
  console.log(`🗑️   Deleted ${res.rowCount} sessions`);
}

// 2. Delete users by email pattern (catches any the CSV might have missed)
const userRes = await pool.query(
  `DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid' RETURNING id`
);
console.log(`🗑️   Deleted ${userRes.rowCount} users (loadtest.%@loadtest.invalid)`);

// 3. Archive CSV
if (fs.existsSync(csvPath)) {
  const archived = csvPath.replace(".csv", `.${Date.now()}.used.csv`);
  fs.renameSync(csvPath, archived);
  console.log(`📦  CSV archived → ${path.basename(archived)}`);
}

await pool.end();
console.log(`\n✅  Cleanup complete. Production DB is clear of test accounts.`);
