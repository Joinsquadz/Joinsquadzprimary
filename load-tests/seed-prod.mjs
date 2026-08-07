#!/usr/bin/env node
/**
 * load-tests/seed-prod.mjs
 *
 * Creates N disposable test accounts by inserting directly into the
 * PRODUCTION database for load-testing against the live deployment URL.
 *
 * After creating accounts this script also:
 *   1. Creates one shared "LoadTest Squad" and adds all accounts as members
 *      (so /api/squads returns real rows and the GIN member_ids index is hit)
 *   2. Inserts a squad conversation + participant rows
 *      (so /api/messages returns real rows)
 *   3. Seeds 2 events per account hosted in the shared squad
 *      (so /api/events returns real rows and event fan-out is exercised)
 *
 * This ensures the hot read paths — squad member joins, event fan-out,
 * feed union — are exercised under load, not just empty-table fast-paths.
 *
 * Handles postgres URLs with special-char passwords (avoids new URL() which
 * chokes on commas and slashes in the password field).
 *
 * Output:
 *   load-tests/.test-accounts.csv  (token,email,userId)
 *   load-tests/.test-meta.json     (squadId, conversationId for cleanup)
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

const OUT_CSV  = path.join(__dirname, ".test-accounts.csv");
const OUT_META = path.join(__dirname, ".test-meta.json");

const COUNT = Number(
  process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? "100",
);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_COST   = 16384;
const SCRYPT_KEYLEN = 64;
const EVENTS_PER_USER = 2; // events seeded per account

// ── Parse postgres URL without new URL() ───────────────────────────────────
// new URL() chokes on special chars (/ , etc.) in postgres passwords.
// We split on the LAST @ to safely separate credentials from host.
function parsePostgresUrl(raw) {
  const stripped = raw.replace(/^postgresql?:\/\//, "");
  const lastAt   = stripped.lastIndexOf("@");
  if (lastAt === -1) throw new Error("No @ found in DB URL");
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
  const salt    = crypto.randomBytes(16);
  const derived = crypto.scryptSync(pw, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function randomInviteCode() {
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

const PASSWORD     = "LoadTest!2026#secure";
const passwordHash = hashPassword(PASSWORD);
const timestamp    = Date.now();

// Tag used to identify all load-test rows for cleanup
const LT_TAG = `loadtest.${timestamp}`;

const pool = new Pool({
  host, port, user, password, database,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 15_000,
});

// ── 1. Create user accounts ──────────────────────────────────────────────────
console.log(`\n[1/4] Creating ${COUNT} user accounts…`);

const rows = ["token,email,userId"];
const userIds = [];
let created = 0;
let failed  = 0;

for (let i = 1; i <= COUNT; i++) {
  const email      = `loadtest.${timestamp}.${String(i).padStart(3, "0")}@loadtest.invalid`;
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
    userIds.push(userId);

    const sid         = crypto.randomBytes(32).toString("hex");
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
    process.stdout.write(`  ${i}/${COUNT} (${created} ok, ${failed} failed)\r`);
  }
}
process.stdout.write("\n");
console.log(`  ✓ ${created} accounts created${failed ? `, ${failed} failed` : ""}`);

if (userIds.length === 0) {
  console.error("❌  No users created, aborting.");
  await pool.end();
  process.exit(1);
}

// ── 2. Create shared squad with all members ──────────────────────────────────
console.log(`\n[2/4] Creating shared squad (${userIds.length} members)…`);

const creatorId  = userIds[0];
const memberJson = JSON.stringify(userIds);

let squadId;
try {
  const squadRes = await pool.query(
    `INSERT INTO squads
       (name, description, emoji, color, member_ids, is_public, creator_id,
        members_can_invite, invite_code, version, created_at)
     VALUES ($1, $2, '🧪', '#FF5C3A', $3::jsonb, false, $4, false, $5, 1, NOW())
     RETURNING id`,
    [
      `LoadTest Squad ${timestamp}`,
      `Temporary load-test squad. Tag: ${LT_TAG}`,
      memberJson,
      creatorId,
      randomInviteCode(),
    ],
  );
  squadId = squadRes.rows[0].id;
  console.log(`  ✓ Squad created: ${squadId}`);
} catch (err) {
  console.error(`  ❌  Failed to create squad: ${err instanceof Error ? err.message : err}`);
  // Non-fatal: events can still be seeded without a squad, tests still run
  squadId = null;
}

// Insert squad_member_history rows (append-only; powers DM eligibility checks)
if (squadId) {
  try {
    const histValues = userIds
      .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}, NOW())`)
      .join(", ");
    const histParams = userIds.flatMap((uid) => [squadId, uid]);
    await pool.query(
      `INSERT INTO squad_member_history (squad_id, user_id, first_joined_at)
       VALUES ${histValues}
       ON CONFLICT DO NOTHING`,
      histParams,
    );
    console.log(`  ✓ squad_member_history: ${userIds.length} rows`);
  } catch (err) {
    console.warn(`  ⚠️  squad_member_history insert failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── 3. Create squad conversation + participants ──────────────────────────────
console.log(`\n[3/4] Creating squad conversation…`);

let conversationId = null;
if (squadId) {
  try {
    const convRes = await pool.query(
      `INSERT INTO conversations
         (type, squad_id, created_by, last_message_at, last_message_preview,
          last_message_sender_id, created_at)
       VALUES ('squad', $1, $2, NOW(), 'Load test ready 🚀', $2, NOW())
       ON CONFLICT (squad_id) DO UPDATE
         SET last_message_preview = EXCLUDED.last_message_preview
       RETURNING id`,
      [squadId, creatorId],
    );
    conversationId = convRes.rows[0].id;
    console.log(`  ✓ Conversation created: ${conversationId}`);
  } catch (err) {
    console.warn(`  ⚠️  Conversation insert failed: ${err instanceof Error ? err.message : err}`);
  }

  if (conversationId) {
    try {
      // Batch-insert all participants; ignore conflicts from any pre-existing rows
      const BATCH = 50;
      let pInserted = 0;
      for (let b = 0; b < userIds.length; b += BATCH) {
        const chunk  = userIds.slice(b, b + BATCH);
        const vals   = chunk.map((_, i) => `(gen_random_uuid(), $1, $${i + 2}, NOW())`).join(", ");
        const params = [conversationId, ...chunk];
        const res    = await pool.query(
          `INSERT INTO conversation_participants (id, conversation_id, user_id, created_at)
           VALUES ${vals}
           ON CONFLICT (conversation_id, user_id) DO NOTHING`,
          params,
        );
        pInserted += res.rowCount ?? 0;
      }
      console.log(`  ✓ conversation_participants: ${pInserted} rows`);
    } catch (err) {
      console.warn(`  ⚠️  Participant insert failed: ${err instanceof Error ? err.message : err}`);
    }
  }
} else {
  console.log("  ⚠️  Skipped (no squad)");
}

// ── 4. Seed 2 events per user ────────────────────────────────────────────────
console.log(`\n[4/4] Seeding ${EVENTS_PER_USER} events per user (${userIds.length * EVENTS_PER_USER} total)…`);

// Events 1 week and 2 weeks out so they appear in the upcoming events list
const EVENT_OFFSETS_DAYS = [7, 14];
const EVENT_TITLES = [
  "LoadTest Hangout",
  "LoadTest Team Meetup",
];

let eventsCreated = 0;
let eventsFailed  = 0;
const eventIds    = [];

// Process in batches to avoid overwhelming the pooler
const EVENT_BATCH = 20;
for (let b = 0; b < userIds.length; b += EVENT_BATCH) {
  const chunk = userIds.slice(b, b + EVENT_BATCH);
  await Promise.all(
    chunk.map(async (uid, chunkIdx) => {
      const globalIdx = b + chunkIdx;
      for (let e = 0; e < EVENTS_PER_USER; e++) {
        const daysOut   = EVENT_OFFSETS_DAYS[e % EVENT_OFFSETS_DAYS.length];
        const eventAt   = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
        const displayDate = eventAt.toLocaleDateString("en-US", {
          weekday: "short", month: "short", day: "numeric",
        });
        const title = `${EVENT_TITLES[e % EVENT_TITLES.length]} ${globalIdx + 1}`;

        try {
          const evRes = await pool.query(
            `INSERT INTO events
               (type, emoji, title, date, event_at, all_day, cover_style, location,
                squad_id, squad_name, host_id, co_admin_ids, description, invite_code,
                cancelled, rsvps, tasks, costs, polls, messages, itinerary, packing,
                invited_user_ids, is_public, version, created_at)
             VALUES (
               'event', '🧪', $1, $2, $3, false, '', $4,
               $5, $6, $7, '[]'::jsonb, $8, $9,
               false, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
               '[]'::jsonb, false, 1, NOW()
             )
             RETURNING id`,
            [
              title,
              displayDate,
              eventAt.toISOString(),
              "LoadTest Venue, San Francisco CA",
              squadId ?? "",
              squadId ? `LoadTest Squad ${timestamp}` : "Personal",
              uid,
              `Load test event — tag: ${LT_TAG}`,
              randomInviteCode(),
            ],
          );
          eventIds.push(evRes.rows[0].id);
          eventsCreated++;
        } catch (err) {
          eventsFailed++;
          if (eventsFailed <= 3) {
            console.warn(`  ⚠️  Event insert failed for user ${uid}: ${err instanceof Error ? err.message : err}`);
          }
        }
      }
    }),
  );

  const done = Math.min(b + EVENT_BATCH, userIds.length);
  process.stdout.write(`  ${done}/${userIds.length} users processed\r`);
}
process.stdout.write("\n");
console.log(`  ✓ ${eventsCreated} events created${eventsFailed ? `, ${eventsFailed} failed` : ""}`);

// ── Write output files ───────────────────────────────────────────────────────
await pool.end();

fs.writeFileSync(OUT_CSV, rows.join("\n") + "\n");

const meta = {
  tag:            LT_TAG,
  timestamp,
  squadId,
  conversationId,
  eventCount:     eventsCreated,
  userCount:      created,
};
fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n");

console.log(`\n✅  Seed complete`);
console.log(`   Users:    ${created}`);
console.log(`   Squad:    ${squadId ?? "none"}`);
console.log(`   Events:   ${eventsCreated}`);
console.log(`   Accounts: ${OUT_CSV}`);
console.log(`   Metadata: ${OUT_META}`);
if (failed > 0) console.warn(`   ⚠️  ${failed} accounts failed`);
console.log(`\n   Token format: 64-char hex SID (valid for 7 days)`);
console.log(`   ⚠️  Run cleanup-prod.mjs after the test!\n`);
