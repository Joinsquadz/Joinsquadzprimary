#!/usr/bin/env node
/**
 * load-tests/cleanup-prod.mjs
 *
 * Removes all load-test rows from the PRODUCTION database:
 *   - Sessions (by SID from .test-accounts.csv)
 *   - Events (by hostId from test users, OR title pattern)
 *   - Conversation participants (by conversationId from .test-meta.json)
 *   - Conversation (by squadId)
 *   - squad_member_history (by squadId)
 *   - Squad (by id from .test-meta.json, OR name pattern)
 *   - Users (by email pattern loadtest.%@loadtest.invalid)
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
const _require   = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { Pool }   = _require("pg");

function parsePostgresUrl(raw) {
  const stripped = raw.replace(/^postgresql?:\/\//, "");
  const lastAt   = stripped.lastIndexOf("@");
  const credPart = stripped.slice(0, lastAt);
  const hostPart = stripped.slice(lastAt + 1);
  const colonInCred = credPart.indexOf(":");
  const user        = credPart.slice(0, colonInCred);
  const password    = credPart.slice(colonInCred + 1);
  const slashInHost = hostPart.indexOf("/");
  const hostPort    = hostPart.slice(0, slashInHost);
  const database    = hostPart.slice(slashInHost + 1);
  const colonInHP   = hostPort.lastIndexOf(":");
  const host        = hostPort.slice(0, colonInHP);
  const urlPort     = parseInt(hostPort.slice(colonInHP + 1));
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

// ── Read sidecar files ───────────────────────────────────────────────────────
const csvPath  = path.join(__dirname, ".test-accounts.csv");
const metaPath = path.join(__dirname, ".test-meta.json");

let sids    = [];
let userIds = [];
if (fs.existsSync(csvPath)) {
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").slice(1).filter(Boolean);
  for (const line of lines) {
    const parts = line.split(",");
    if (parts[0]) sids.push(parts[0]);
    if (parts[2]) userIds.push(parts[2]);
  }
  console.log(`📋  CSV: ${sids.length} sessions, ${userIds.length} user IDs`);
} else {
  console.warn("⚠️   No .test-accounts.csv found — will rely on email pattern only");
}

let meta = null;
if (fs.existsSync(metaPath)) {
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    console.log(`📋  Meta: tag=${meta.tag}, squadId=${meta.squadId}, conversationId=${meta.conversationId}`);
  } catch {
    console.warn("⚠️   Could not parse .test-meta.json — will rely on name patterns");
  }
} else {
  console.warn("⚠️   No .test-meta.json found — will rely on name patterns");
}

console.log(`\n🗑️   Cleaning up load-test data from PRODUCTION (${host}:${port})…\n`);

// ── 1. Delete events ─────────────────────────────────────────────────────────
// Primary: delete by host_id (covers all events we seeded even if meta is missing)
// Fallback: delete by title pattern
if (userIds.length > 0) {
  const BATCH = 50;
  let eventsDeleted = 0;
  for (let b = 0; b < userIds.length; b += BATCH) {
    const chunk        = userIds.slice(b, b + BATCH);
    const placeholders = chunk.map((_, i) => `$${i + 1}`).join(", ");
    const res = await pool.query(
      `DELETE FROM events WHERE host_id IN (${placeholders}) RETURNING id`,
      chunk,
    );
    eventsDeleted += res.rowCount ?? 0;
  }
  console.log(`🗑️   Deleted ${eventsDeleted} events (by host_id)`);
} else {
  // Fallback: match on description tag or title pattern
  const res = await pool.query(
    `DELETE FROM events
     WHERE title LIKE 'LoadTest%'
        OR description LIKE 'Load test event — tag: loadtest.%'
     RETURNING id`,
  );
  console.log(`🗑️   Deleted ${res.rowCount} events (by title/description pattern)`);
}

// ── 2. Delete conversation participants ──────────────────────────────────────
const convId = meta?.conversationId ?? null;
if (convId) {
  const res = await pool.query(
    `DELETE FROM conversation_participants WHERE conversation_id = $1 RETURNING id`,
    [convId],
  );
  console.log(`🗑️   Deleted ${res.rowCount} conversation participants`);
} else if (userIds.length > 0) {
  // Fallback: delete any participant rows belonging to test users
  const BATCH = 50;
  let total = 0;
  for (let b = 0; b < userIds.length; b += BATCH) {
    const chunk        = userIds.slice(b, b + BATCH);
    const placeholders = chunk.map((_, i) => `$${i + 1}`).join(", ");
    const res = await pool.query(
      `DELETE FROM conversation_participants WHERE user_id IN (${placeholders}) RETURNING id`,
      chunk,
    );
    total += res.rowCount ?? 0;
  }
  console.log(`🗑️   Deleted ${total} conversation participants (by user_id)`);
}

// ── 3. Delete conversation ───────────────────────────────────────────────────
if (convId) {
  const res = await pool.query(
    `DELETE FROM conversations WHERE id = $1 RETURNING id`,
    [convId],
  );
  console.log(`🗑️   Deleted ${res.rowCount} conversation`);
}

// ── 4. Delete squad_member_history ───────────────────────────────────────────
const squadId = meta?.squadId ?? null;
if (squadId) {
  const res = await pool.query(
    `DELETE FROM squad_member_history WHERE squad_id = $1 RETURNING squad_id`,
    [squadId],
  );
  console.log(`🗑️   Deleted ${res.rowCount} squad_member_history rows`);
}

// ── 5. Delete squad ──────────────────────────────────────────────────────────
if (squadId) {
  const res = await pool.query(
    `DELETE FROM squads WHERE id = $1 RETURNING id`,
    [squadId],
  );
  console.log(`🗑️   Deleted ${res.rowCount} squad (by id)`);
} else {
  // Fallback: name pattern
  const res = await pool.query(
    `DELETE FROM squads WHERE name LIKE 'LoadTest Squad %' RETURNING id`,
  );
  console.log(`🗑️   Deleted ${res.rowCount} squads (by name pattern)`);
}

// ── 6. Delete sessions ───────────────────────────────────────────────────────
if (sids.length > 0) {
  const BATCH = 100;
  let total = 0;
  for (let b = 0; b < sids.length; b += BATCH) {
    const chunk        = sids.slice(b, b + BATCH);
    const placeholders = chunk.map((_, i) => `$${i + 1}`).join(", ");
    const res = await pool.query(
      `DELETE FROM sessions WHERE sid IN (${placeholders}) RETURNING sid`,
      chunk,
    );
    total += res.rowCount ?? 0;
  }
  console.log(`🗑️   Deleted ${total} sessions`);
}

// ── 7. Delete users by email pattern ────────────────────────────────────────
// This is the definitive sweep — catches anything the CSV might have missed
const userRes = await pool.query(
  `DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid' RETURNING id`,
);
console.log(`🗑️   Deleted ${userRes.rowCount} users (loadtest.%@loadtest.invalid)`);

// ── Archive sidecar files ────────────────────────────────────────────────────
const ts = Date.now();
for (const [src, label] of [[csvPath, "csv"], [metaPath, "meta"]]) {
  if (fs.existsSync(src)) {
    const archived = src.replace(/\.(csv|json)$/, `.${ts}.used.$1`);
    fs.renameSync(src, archived);
    console.log(`📦  ${label} archived → ${path.basename(archived)}`);
  }
}

await pool.end();
console.log(`\n✅  Cleanup complete. Production DB is clear of load-test data.`);
