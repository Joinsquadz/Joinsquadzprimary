/**
 * Fresh-database validation for the migration chain.
 *
 * Applies every migration in `migrations/` in journal order to a database this
 * script creates itself — with no schemaSync involvement whatsoever — and then
 * diffs the resulting schema against the newest Drizzle snapshot across every
 * drift class the snapshot describes: tables, columns (type, nullability,
 * default), primary keys, unique constraints, check constraints, foreign keys
 * (including delete rules) and indexes. The diff is symmetric: an object the
 * migrations create but the snapshot does not declare fails just like a missing
 * one.
 *
 * Why this exists: the API server repairs schema at boot via
 * `artifacts/api-server/src/lib/schemaSync.ts`, which means missing migrations
 * are invisible in normal operation. A snapshot regenerated against a
 * schemaSync'd database then claims objects no migration ever creates, and
 * `drizzle-kit generate` stops emitting them — so the drift compounds silently
 * and only a genuinely fresh bootstrap (a new environment, a restore, a new
 * contributor) discovers the database is unusable.
 *
 * ISOLATION — why this always creates a real database:
 * The script does NOT trust an operator's promise that a database is empty. It
 * connects, creates a uniquely-named scratch DATABASE, validates inside it, and
 * drops it again.
 *
 * There is deliberately NO "just use a scratch schema" fallback. The migrations
 * contain schema-qualified `REFERENCES "public"."…"` clauses, so running them
 * under a different `search_path` would attach foreign keys to whatever lives in
 * the real `public` schema (or fail outright) instead of validating a
 * self-contained one. That would report a result that looks like a pass but
 * means nothing. If the role cannot CREATE DATABASE, this script fails loudly
 * and tells you to point it at a server where it can.
 *
 * Usage — MIGRATION_TEST_DB_URL may name any database on a throwaway server;
 * the scratch database is created next to it and dropped afterwards:
 *   MIGRATION_TEST_DB_URL=postgres://user:pass@host:5432/postgres \
 *     node scripts/validate-migrations.mjs
 *
 * Exits non-zero when a statement fails or ANY difference is found.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import {
  applyMigrations,
  diffAgainstSnapshot,
  introspectSchema,
  loadMigrationPlan,
} from "./lib/schema-diff.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");

const url = process.env.MIGRATION_TEST_DB_URL;
if (!url) {
  console.error(
    "MIGRATION_TEST_DB_URL is required. It may point at ANY database on a throwaway\n" +
      "Postgres server — this script creates and drops its own scratch database, and\n" +
      "the connecting role must be allowed to CREATE DATABASE.",
  );
  process.exit(2);
}

const { journal, snapshotFile, snapshot } = loadMigrationPlan(migrationsDir);
const scratchName = `migval_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

const admin = new pg.Client({ connectionString: url });
await admin.connect();

try {
  await admin.query(`CREATE DATABASE "${scratchName}"`);
} catch (err) {
  console.error(
    `Could not create the scratch database "${scratchName}": ${err.message}\n\n` +
      "This check requires CREATE DATABASE. It intentionally does NOT fall back to a\n" +
      "scratch schema: the migrations reference \"public\" explicitly, so a same-database\n" +
      "run would bind foreign keys to the existing public schema and validate nothing.\n" +
      "Point MIGRATION_TEST_DB_URL at a throwaway Postgres server (a local instance is\n" +
      "fine) with a role that may create databases.",
  );
  await admin.end();
  process.exit(2);
}

const scratchUrl = new URL(url);
scratchUrl.pathname = `/${scratchName}`;
const target = new pg.Client({ connectionString: scratchUrl.toString() });
await target.connect();

const cleanup = async () => {
  await target.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`).catch(() => {});
  await admin.end().catch(() => {});
};

try {
  // A freshly created database should be empty; verify rather than assume, so a
  // template database with objects in it can never masquerade as a clean run.
  const preexisting = await target.query(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`,
  );
  if (preexisting.rows.length > 0) {
    console.error(
      `Scratch database is not empty (${preexisting.rows.length} tables) — the server's\n` +
        "template database appears to contain objects. Aborting rather than reporting a\n" +
        "meaningless diff.",
    );
    await cleanup();
    process.exit(2);
  }

  const statementFailures = await applyMigrations(target, migrationsDir, journal);

  const built = await introspectSchema(target, "public");
  const problems = [
    ...statementFailures.map((f) => `STATEMENT FAILED: ${f}`),
    ...diffAgainstSnapshot(built, snapshot),
  ];

  console.log(`\n=== migrations-only result (vs ${path.basename(snapshotFile)}) ===`);
  console.log(`isolation: scratch database "${scratchName}"`);
  console.log(
    `tables in snapshot: ${Object.keys(snapshot.tables).length} | tables created: ${built.columns.size}`,
  );
  console.log(
    "checked (both directions): columns (type/nullability/default), primary keys, " +
      "unique constraints, check constraints, foreign keys (+delete rules), indexes",
  );

  if (problems.length === 0) {
    console.log("\nNo drift. A fresh database built from migrations alone matches the snapshot.");
  } else {
    console.error(`\n${problems.length} PROBLEM(S):`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }

  await cleanup();
  process.exit(problems.length === 0 ? 0 : 1);
} catch (err) {
  console.error(`Validation aborted: ${err.stack ?? err.message}`);
  await cleanup();
  process.exit(2);
}
