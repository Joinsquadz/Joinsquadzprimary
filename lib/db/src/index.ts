import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Prefer an explicit Supabase Postgres connection string when present, so the
// database can be migrated to Supabase without overwriting Replit's
// runtime-managed DATABASE_URL. Falls back to DATABASE_URL otherwise.
const connectionString =
  process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "No database connection string set. Provide SUPABASE_DB_URL or DATABASE_URL.",
  );
}

// Supabase requires TLS; enable it (without rejecting their managed cert chain)
// when connecting to a Supabase host.
const isSupabase = /supabase\.(co|com)/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
