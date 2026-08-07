#!/usr/bin/env npx tsx
/**
 * load-tests/cleanup.ts
 *
 * Deletes all test accounts created by seed.ts from Supabase.
 * Reads load-tests/.test-accounts.csv for the userId list, then
 * calls supabase.auth.admin.deleteUser() for each row.
 *
 * Usage:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   npx tsx load-tests/cleanup.ts
 *
 * Alternative SQL (run in Supabase SQL editor for a given timestamp batch):
 *   DELETE FROM auth.users WHERE email LIKE 'loadtest.%@loadtest.invalid';
 *
 * ⚠️  Deleting a user from Supabase auth removes their row from auth.users
 *     but NOT from the app's `users` table (foreign-keyed on supabase subject).
 *     The app's row becomes an orphan with no valid login path — safe to leave
 *     or clean up manually:
 *       DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid';
 */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CSV_PATH = path.join(import.meta.dirname ?? __dirname, ".test-accounts.csv");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌  SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
if (!fs.existsSync(CSV_PATH)) {
  console.error(`❌  ${CSV_PATH} not found. Nothing to clean up.`);
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const lines = fs.readFileSync(CSV_PATH, "utf8").split("\n").filter(Boolean);
// Skip header row (token,email,userId).
const rows = lines.slice(1).map((line) => {
  const [token, email, userId] = line.split(",");
  return { token, email, userId };
});

console.log(`\n🧹  Cleaning up ${rows.length} test accounts from Supabase\n`);

let deleted = 0;
let failed = 0;

for (const { userId, email } of rows) {
  if (!userId) {
    failed++;
    continue;
  }
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    console.error(`  ❌  ${email} (${userId}): ${error.message}`);
    failed++;
  } else {
    deleted++;
  }
}

console.log(`\n✅  Deleted ${deleted} Supabase auth users.`);
if (failed > 0) {
  console.warn(`⚠️   ${failed} deletions failed — check Supabase dashboard.`);
}

// Rename the CSV so it's not accidentally reused with expired tokens.
const archivePath = CSV_PATH.replace(".csv", `.${Date.now()}.used.csv`);
fs.renameSync(CSV_PATH, archivePath);
console.log(`\n📦  CSV archived to ${archivePath} (tokens are now expired/invalid)\n`);

console.log("Next step — remove orphaned app `users` rows on staging:");
console.log("  DELETE FROM users WHERE email LIKE 'loadtest.%@loadtest.invalid';\n");
