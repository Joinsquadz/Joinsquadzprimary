#!/usr/bin/env node
/**
 * load-tests/seed-prod.mjs
 *
 * Creates N disposable test accounts by inserting directly into the
 * PRODUCTION database for load-testing against the live deployment URL.
 *
 * Handles postgres URLs with special-char passwords (avoids new URL() which
 * chokes on commas and slashes in the password field).
 *
 * Output: load-tests/.test-accounts.csv (token,email,userId)
 *
 * Usage:
 *   node load-tests/seed-prod.mjs [--count=100]
 *
 * Reads SUPABASE_DB_URL from the environment (the production database).
 * Overrides the port to DB_POOLER_PORT (default 6543, Transaction pooler).
 *
 * ⚠️  Cleans up with cleanup-prod.mjs after the load test.
 *     All inserted rows have email LIKE 'loadtest.%@loadtest.invalid'
 *     so cleanup is a single DELETE.
 */

import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _require = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool } = _require("pg");

const OUT = path.join(__dirname, ".test-accounts.csv");
const COUNT = Number(
  process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? "100",
);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_COST = 16384;
const SCRYPT_KEYLEN = 64;

// ── Parse postgres URL without new URL() ───────────────────────────────────
// new URL() chokes on special chars (/ , etc.) in postgres passwords.
// We split on the LAST @ to safely separate credentials from host.
function parsePostgresUrl(raw) {
  const stripped = raw.replace(/^postgresql?:\/\//, "");
  const lastAt = stripped.lastIndexOf("@");
  if (lastAt === -1) throw new Error("No @ found in DB URL");
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
if (!rawUrl) {
  console.error("❌  SUPABASE_DB_URL is required.");
  process.exit(1);
}
// Safety: refuse to run against the staging project
if (rawUrl.includes("oalnboykhpvghibkxwdd")) {
  console.error("❌  SUPABASE_DB_URL matches staging project. Use seed-direct.mjs for staging.");
  process.exit(1);
}

const { user, password, host, urlPort, database } = parsePostgresUrl(rawUrl);
const port = parseInt(process.env.DB_POOLER_PORT ?? String(urlPort));

console.log(`\n🌱  Seeding ${COUNT} test accounts → PRODUCTION (${host}:${port})`);
console.log("   ⚠️  Accounts will be in the live DB. Run cleanup-prod.mjs after the test.\n");

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const PASSWORD = "LoadTest!2026#secure";
const passwordHash = hashPassword(PASSWORD);
const timestamp = Date.now();

const pool = new Pool({
  host, port, user, password, database,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15_000,
});

const rows = ["token,email,userId"];
let created = 0;
let failed = 0;

for (let i = 1; i <= COUNT; i++) {
  const email = `loadtest.${timestamp}.${String(i).padStart(3, "0")}@loadtest.invalid`;
  const friendCode = `LT${timestamp % 100000}${String(i).padStart(3, "0")}`;

  try {
    const userRes = await pool.query(
      `INSERT INTO users
         (email, password_hash, first_name, last_name, email_verified, friend_code,
          created_at, updated_at)
       VALUES ($1, $2, 'Load', $3, false, $4, NOW(), NOW())
       RETURNING id`,
      [email, passwordHash, `Test${i}`, friendCode],
    );
    const userId = userRes.rows[0].id;

    const sid = crypto.randomBytes(32).toString("hex");
    const sessionData = {
      user: { id: userId, email, firstName: "Load", lastName: `Test${i}`, profileImageUrl: null },
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
console.log(`   Token format: 64-char hex SID (valid for 7 days)`);
console.log(`   ⚠️  Run cleanup-prod.mjs after the test!\n`);
