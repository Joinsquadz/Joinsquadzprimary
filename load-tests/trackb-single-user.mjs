#!/usr/bin/env node
/**
 * Track B: single-user diagnostic against production endpoints.
 * Creates one test account, hits each endpoint once at zero concurrency,
 * then retries 5 times with a brief gap — captures HTTP status + full body.
 * Cleans up on exit.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

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
if (!rawUrl) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }
const { user, password, host, urlPort, database } = parsePostgresUrl(rawUrl);
const port = parseInt(process.env.DB_POOLER_PORT ?? String(urlPort));

const pool = new Pool({
  host, port, user, password, database,
  ssl: { rejectUnauthorized: false },
  max: 2, connectionTimeoutMillis: 15_000,
});

// ── Create one test account ──────────────────────────────────────────────────
const salt = crypto.randomBytes(16);
const derived = crypto.scryptSync("LoadTest!2026#secure", salt, 64, { N: 16384 });
const passwordHash = `scrypt$16384$${salt.toString("hex")}$${derived.toString("hex")}`;
const ts = Date.now();
const email = `loadtest.${ts}.trackb@loadtest.invalid`;
const friendCode = `TB${ts % 100000}`;

const { rows: [{ id: userId }] } = await pool.query(
  `INSERT INTO users (email, password_hash, first_name, last_name, email_verified,
    friend_code, created_at, updated_at)
   VALUES ($1,$2,'Track','B',false,$3,NOW(),NOW()) RETURNING id`,
  [email, passwordHash, friendCode],
);
const sid = crypto.randomBytes(32).toString("hex");
await pool.query(
  `INSERT INTO sessions (sid, sess, expire) VALUES ($1,$2,$3)`,
  [sid, JSON.stringify({ user: { id: userId, email, firstName: "Track", lastName: "B", profileImageUrl: null } }),
   new Date(Date.now() + 86_400_000)],
);
console.log(`\n✅ Created test account  userId=${userId}  token=${sid.slice(0,8)}…\n`);

// ── Hit each endpoint, 5 sequential attempts with 500ms gap ─────────────────
const BASE = "https://joinsquadz.com";
const ENDPOINTS = ["/api/squads", "/api/events", "/api/feed", "/api/activity", "/api/notifications/preferences"];
const TRIES = 5;
const DELAY = 500; // ms between tries — zero concurrency

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const path of ENDPOINTS) {
  console.log(`\n═══ ${path} (${TRIES} sequential requests, ${DELAY}ms apart) ═══`);
  for (let i = 1; i <= TRIES; i++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { Authorization: `Bearer ${sid}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text();
      const preview = body.length > 300 ? body.slice(0, 300) + "…" : body;
      console.log(`  [${i}/${TRIES}] HTTP ${res.status}  body=${preview}`);
    } catch (err) {
      console.log(`  [${i}/${TRIES}] NETWORK ERROR: ${err.message}`);
    }
    if (i < TRIES) await sleep(DELAY);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
await pool.query(`DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid'`);
await pool.end();
console.log(`\n🗑️  Test account cleaned up.\n`);
