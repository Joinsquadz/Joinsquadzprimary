#!/usr/bin/env node
/**
 * load-tests/migrate-staging.mjs
 *
 * Applies the Drizzle-managed schema to the staging database.
 * Uses the same generate→apply approach as the concurrency test harness.
 *
 * MUST be run with STAGING_DB_URL pointing at the staging Transaction pooler
 * URL, NOT the production URL.
 *
 * Usage:
 *   STAGING_DB_URL='postgresql://...' node load-tests/migrate-staging.mjs
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const _require = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
);
const pg = _require("pg");

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DB_URL = process.env.STAGING_DB_URL;
if (!DB_URL) {
  console.error("❌  STAGING_DB_URL is required. Set it to the staging Transaction pooler URL.");
  process.exit(1);
}

// Safety check: must target the staging project, not production.
if (!DB_URL.includes("oalnboykhpvghibkxwdd")) {
  console.error("❌  STAGING_DB_URL does not match the expected staging project ID.");
  console.error("    Refusing to run migrations against an unrecognised database.");
  process.exit(1);
}

// Confirm port 6543 (Transaction pooler).
if (!DB_URL.includes(":6543")) {
  console.error("❌  STAGING_DB_URL must use port 6543 (Transaction pooler).");
  console.error("    Session pooler (5432) is not suitable for the load test.");
  process.exit(1);
}

console.log("✅  Target: staging Transaction pooler (oalnboykhpvghibkxwdd:6543)");
console.log("✅  Production env vars untouched — SUPABASE_DB_URL not modified\n");

// 1. Generate SQL from the Drizzle schema (offline — no DB connection yet).
const dbPkgDir = path.join(ROOT, "lib", "db");
const drizzleBin = path.join(dbPkgDir, "node_modules", ".bin", "drizzle-kit");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "staging-drizzle-"));

console.log("→ Generating Drizzle schema SQL (offline)…");
execFileSync(
  drizzleBin,
  ["generate", "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--out", outDir],
  { cwd: dbPkgDir, stdio: "pipe" },
);
const sqlFiles = fs.readdirSync(outDir).filter((f) => f.endsWith(".sql")).sort();
console.log(`  Generated ${sqlFiles.length} SQL file(s): ${sqlFiles.join(", ")}\n`);

// 2. Apply each SQL file to the staging DB.
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false }, // Supabase pooler self-signed cert
  max: 2,
  connectionTimeoutMillis: 10_000,
});

let totalStmts = 0;
for (const f of sqlFiles) {
  const raw = fs.readFileSync(path.join(outDir, f), "utf8");
  const stmts = raw
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`→ Applying ${f} (${stmts.length} statements)…`);
  for (const stmt of stmts) {
    try {
      await pool.query(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists") || msg.includes("duplicate")) {
        // Idempotent — safe to ignore.
      } else {
        console.error(`  ❌  Statement failed:\n${stmt}\n  Error: ${msg}`);
        throw err;
      }
    }
  }
  totalStmts += stmts.length;
}
console.log(`\n✅  Drizzle schema applied (${totalStmts} statements across ${sqlFiles.length} file(s))`);

await pool.end();
console.log("   Connection closed.\n");
