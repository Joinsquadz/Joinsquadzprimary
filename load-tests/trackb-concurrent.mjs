#!/usr/bin/env node
/**
 * Track B Phase 2: concurrent-load reproduction against production.
 * Creates one account, fires CONCURRENCY requests simultaneously against
 * each endpoint, captures status + full body for any non-200 responses.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

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

const { user, password, host, urlPort, database } = parsePostgresUrl(process.env.SUPABASE_DB_URL);
const port = parseInt(process.env.DB_POOLER_PORT ?? String(urlPort));
const pool = new Pool({ host, port, user, password, database, ssl: { rejectUnauthorized: false }, max: 2 });

// Create 5 distinct accounts so we hit the rate limiter with different keys
const ACCOUNTS = 5;
const tokens = [];
const ts = Date.now();

for (let i = 1; i <= ACCOUNTS; i++) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync("LoadTest!2026#secure", salt, 64, { N: 16384 });
  const pwHash = `scrypt$16384$${salt.toString("hex")}$${derived.toString("hex")}`;
  const email = `loadtest.${ts}.c${i}@loadtest.invalid`;
  const { rows: [{ id }] } = await pool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,email_verified,friend_code,created_at,updated_at)
     VALUES ($1,$2,'Track','C',false,$3,NOW(),NOW()) RETURNING id`,
    [email, pwHash, `TC${ts%100000}${i}`]
  );
  const sid = crypto.randomBytes(32).toString("hex");
  await pool.query(`INSERT INTO sessions(sid,sess,expire) VALUES($1,$2,$3)`,
    [sid, JSON.stringify({ user: { id, email, firstName: "Track", lastName: "C", profileImageUrl: null } }),
     new Date(Date.now() + 86400000)]);
  tokens.push({ sid, email, id });
}
console.log(`\n✅ Created ${ACCOUNTS} test accounts\n`);

const BASE = "https://joinsquadz.com";
const ENDPOINTS = ["/api/squads", "/api/events", "/api/feed", "/api/activity"];
const ROUNDS = 4;  // each round fires ACCOUNTS×ENDPOINTS requests simultaneously

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n── Round ${round}/${ROUNDS}: ${ACCOUNTS * ENDPOINTS.length} simultaneous requests ──`);
  const promises = [];
  for (const { sid } of tokens) {
    for (const path of ENDPOINTS) {
      promises.push(
        fetch(BASE + path, {
          headers: { Authorization: `Bearer ${sid}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(12_000),
        }).then(async r => ({
          path,
          status: r.status,
          body: r.status >= 400 ? await r.text() : "(ok)",
          ms: Date.now(),
        })).catch(err => ({ path, status: "ERR", body: err.message }))
      );
    }
  }
  const results = await Promise.all(promises);
  const byStatus = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  console.log("  Status breakdown:", JSON.stringify(byStatus));
  for (const r of results.filter(r => r.status >= 500)) {
    console.log(`  ❌ ${r.path} → ${r.status}: ${r.body.slice(0, 400)}`);
  }
  // small gap between rounds
  await new Promise(r => setTimeout(r, 200));
}

// Cleanup
for (const { sid } of tokens) await pool.query(`DELETE FROM sessions WHERE sid=$1`, [sid]);
await pool.query(`DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid'`);
await pool.end();
console.log(`\n🗑️  Cleaned up ${ACCOUNTS} test accounts.\n`);
