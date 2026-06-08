import { defineConfig } from "drizzle-kit";
import path from "path";

// Prefer the Supabase connection string when present (so `push` targets
// Supabase), falling back to the Replit-managed DATABASE_URL.
const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "No database connection string set. Provide SUPABASE_DB_URL or DATABASE_URL.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url,
    ...(/supabase\.(co|com)/.test(url) ? { ssl: { rejectUnauthorized: false } } : {}),
  },
});
