#!/usr/bin/env node
/**
 * load-tests/seed-direct.mjs
 *
 * Creates N disposable test accounts by inserting directly into the
 * staging database — no Supabase Admin API key required.
 *
 * Auth path: non-Supabase (email/password → users table). Sessions are
 * inserted into the sessions table with random 64-char hex SIDs. The SIDs
 * serve as Bearer tokens for Artillery.
 *
 * Output: load-tests/.test-accounts.csv (token,email,userId)
 *
 * Usage:
 *   STAGING_DB_URL='postgresql://...' node load-tests/seed-direct.mjs [--count=50]
 *
 * ⚠️  STAGING_DB_URL MUST point at the staging project. This script contains a
 *     hard-coded safety check — it refuses to run against any other host.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname_tmp = path.dirname(fileURLToPath(import.meta.url));
// Resolve pg through lib/db's package (pg is a direct dep there) since the
// load-tests dir has no package.json of its own.
const _require = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
);
const { Pool } = _require("pg");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, ".test-accounts.csv");
const COUNT = Number(
  process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? "50",
);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (matches auth.ts)
const SCRYPT_COST = 16384; // N (matches auth.ts)
const SCRYPT_KEYLEN = 64;

const DB_URL = process.env.STAGING_DB_URL;
if (!DB_URL) {
  console.error("❌  STAGING_DB_URL is required.");
  process.exit(1);
}
if (!DB_URL.includes("oalnboykhpvghibkxwdd")) {
  console.error("❌  STAGING_DB_URL does not match the staging project. Refusing to seed.");
  process.exit(1);
}
if (!DB_URL.includes(":6543")) {
  console.error("❌  STAGING_DB_URL must use port 6543 (Transaction pooler).");
  process.exit(1);
}

console.log(`\n🌱  Seeding ${COUNT} test accounts → staging (oalnboykhpvghibkxwdd:6543)`);
console.log("   Production SUPABASE_DB_URL untouched.\n");

/** Matches hashPassword() in artifacts/api-server/src/lib/auth.ts */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const PASSWORD = "LoadTest!2026#secure";
const passwordHash = hashPassword(PASSWORD); // same hash for all — computed once
const timestamp = Date.now();

const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10_000,
});

const rows = ["token,email,userId"]; // CSV header
let created = 0;
let failed = 0;

for (let i = 1; i <= COUNT; i++) {
  const email = `loadtest.${timestamp}.${String(i).padStart(3, "0")}@loadtest.invalid`;
  const friendCode = `LT${timestamp % 100000}${String(i).padStart(3, "0")}`;

  try {
    // 1. Insert user (id auto-generated as gen_random_uuid()).
    const userRes = await pool.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, email_verified, friend_code,
          created_at, updated_at)
       VALUES ($1, $2, 'Load', $3, false, $4, NOW(), NOW())
       RETURNING id`,
      [email, passwordHash, `Test${i}`, friendCode],
    );
    const userId = userRes.rows[0].id;

    // 2. Insert session. SID is the Bearer token Artillery will use.
    const sid = crypto.randomBytes(32).toString("hex"); // 64-char hex
    const sessionData = {
      user: {
        id: userId,
        email,
        firstName: "Load",
        lastName: `Test${i}`,
        profileImageUrl: null,
      },
    };
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, $3)`,
      [sid, JSON.stringify(sessionData), new Date(Date.now() + SESSION_TTL_MS)],
    );

    rows.push(`${sid},${email},${userId}`);
    created++;
  } catch (err) {
    console.error(`  [${i}/${COUNT}] ❌  ${email}: ${err instanceof Error ? err.message : err}`);
    failed++;
  }

  if (i % 10 === 0 || i === COUNT) {
    process.stdout.write(`  ${i}/${COUNT} (${created} ok, ${failed} failed)\n`);
  }
}

await pool.end();
fs.writeFileSync(OUT, rows.join("\n") + "\n");

console.log(`\n✅  Seeded ${created} accounts → ${OUT}`);
if (failed > 0) console.warn(`⚠️   ${failed} accounts failed`);
console.log(`   Token format: 64-char hex SID (non-Supabase session, valid for 7 days)\n`);
