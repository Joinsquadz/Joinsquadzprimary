#!/usr/bin/env npx tsx
/**
 * load-tests/seed.ts
 *
 * Creates N disposable test accounts and writes their bearer tokens to
 * load-tests/.test-accounts.csv so Artillery can use them without
 * hitting the app's per-IP login rate limit.
 *
 * Accounts are created via the Supabase Admin API (bypasses app rate limits)
 * then signed in via the app's /api/auth/login endpoint to verify the full
 * auth path works and to get the exact same JWT the app would issue.
 *
 * Email domain: loadtest.invalid  (.invalid is IANA-reserved, never routes real mail)
 * Easy cleanup query:  DELETE FROM auth.users WHERE email LIKE 'loadtest.%@loadtest.invalid';
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   LOAD_TEST_TARGET=https://<staging-api-url> \
 *   npx tsx load-tests/seed.ts [--count=100]
 *
 * ⚠️  Point SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY at a STAGING project only.
 *     Never seed against the production Supabase instance.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TARGET = (process.env.LOAD_TEST_TARGET ?? "").replace(/\/$/, "");
const COUNT = Number(process.argv.find((a) => a.startsWith("--count="))?.split("=")[1] ?? "100");
const OUT = path.join(import.meta.dirname ?? __dirname, ".test-accounts.csv");
const PASSWORD = "LoadTest!2026#secure"; // same for all test accounts

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  console.error("    Point them at a STAGING Supabase project, not production.");
  process.exit(1);
}
if (!TARGET) {
  console.error("❌  LOAD_TEST_TARGET is required (e.g. https://staging-api.example.com)");
  process.exit(1);
}

// ── Supabase admin client ─────────────────────────────────────────────────────

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helper: login via the app API (not Supabase directly) ────────────────────

function appPost(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(TARGET + path);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

const timestamp = Date.now();
const rows: string[] = ["token,email,userId"]; // CSV header

console.log(`\n🔧  Seeding ${COUNT} test accounts → ${OUT}`);
console.log(`    Target: ${TARGET}`);
console.log(`    Supabase: ${SUPABASE_URL}\n`);

let created = 0;
let failed = 0;

for (let i = 1; i <= COUNT; i++) {
  const email = `loadtest.${timestamp}.${String(i).padStart(3, "0")}@loadtest.invalid`;

  // 1. Create user via Admin API (no rate limits, email_confirm: true so login works).
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.error(`  [${i}/${COUNT}] ❌  Create failed: ${error?.message ?? "unknown"}`);
    failed++;
    continue;
  }
  const supabaseUserId = data.user.id;

  // 2. Sign in via the app's /api/auth/login to get the app-issued token and
  //    to ensure the users table row is synced (syncSupabaseUser runs in login).
  const loginRes = await appPost("/api/auth/login", {
    email,
    password: PASSWORD,
  }) as { token?: string; error?: string };

  if (!loginRes?.token) {
    console.error(`  [${i}/${COUNT}] ❌  Login failed for ${email}: ${loginRes?.error ?? "no token"}`);
    // Best-effort cleanup of the Supabase user we just created.
    await supabase.auth.admin.deleteUser(supabaseUserId).catch(() => {});
    failed++;
    continue;
  }

  rows.push(`${loginRes.token},${email},${supabaseUserId}`);
  created++;
  if (i % 10 === 0 || i === COUNT) {
    console.log(`  ${i}/${COUNT} created (${created} ok, ${failed} failed)`);
  }
}

fs.writeFileSync(OUT, rows.join("\n") + "\n");

console.log(`\n✅  Seeded ${created} accounts → ${OUT}`);
if (failed > 0) {
  console.warn(`⚠️   ${failed} accounts failed — CSV has ${created} rows (may be < ${COUNT}).`);
}
console.log("\n⏰  Supabase JWTs expire in ~1 hour. Run the load test now.\n");
