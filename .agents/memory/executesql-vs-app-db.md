---
name: executeSql targets Replit DB, not the app's Supabase DB
description: The code_execution executeSql tool connects to Replit's built-in Postgres, which this app does NOT use — the app uses Supabase via SUPABASE_DB_URL.
---

The `executeSql` callback (and `checkDatabase`) in the code_execution sandbox connect to **Replit's built-in managed Postgres**. This app does NOT use that database — it connects to **Supabase** via `SUPABASE_DB_URL` (see `lib/db/src/connection.ts`, which prefers `SUPABASE_DB_URL` over `DATABASE_URL`).

**Tell-tale sign you're on the wrong DB:** querying `auth.users` via `executeSql` returns "relation auth.users does not exist". Supabase ALWAYS has the `auth` schema, so its absence means you're on the Replit DB, not Supabase.

**Why it matters:** a "DB wipe" or any inspection via `executeSql` touches the Replit DB and leaves the real Supabase data untouched. This caused a registration 500 that "wouldn't go away": a stale `users` row with the target email stayed in Supabase; registration created a fresh Supabase auth UUID, then the Drizzle upsert `ON CONFLICT (id) DO UPDATE` hit the `email` UNIQUE constraint (different id, same email) → unhandled unique violation → 500. The Drizzle error only logs "Failed query" and swallows the pg detail, hiding the real constraint.

**How to operate on the actual app DB:** run SQL against `SUPABASE_DB_URL`. Easiest is a short `tsx` script in `@workspace/scripts` that does `new Pool(resolveDbConfig())` (imported from `@workspace/db`) — it reuses the exact same connection parsing the app uses. Run via `pnpm --filter @workspace/scripts exec tsx <script>` from bash (bash has env vars; the code_execution sandbox does NOT expose process.env).

**Supabase Auth users** live behind the Admin REST API, not in the pooler DB you can SQL into. List/delete via `${SUPABASE_URL}/auth/v1/admin/users` with `Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY` + `apikey` header. A failed registration can leave an orphaned auth user (createUser succeeded, public.users upsert failed) → subsequent registers return 409; delete the orphan to recover.
