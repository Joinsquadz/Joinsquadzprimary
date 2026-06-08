---
name: Supabase Postgres on Replit
description: Connecting the app's Postgres to Supabase from Replit — IPv4 pooler requirement and special-char password parsing.
---

# Supabase Postgres on Replit

Two non-obvious things break a Supabase DB connection from Replit. Both cost real time because the failures are silent/swallowed.

## 1. Direct connection is IPv6-only — use the Session pooler
- `db.<ref>.supabase.co` (Supabase "Direct connection") has **only an AAAA (IPv6) record**, no A record. Replit's network is **IPv4-only**, so the connection just **hangs** (e.g. `drizzle-kit push` stalls at "Pulling schema from database…" then exits 1 with no error).
- Fix: use the **Session pooler** string — host `aws-*.pooler.supabase.com:5432`, user `postgres.<project-ref>`. It resolves to IPv4 and supports prepared statements (good for both runtime and `drizzle-kit push`). Avoid the Transaction pooler (6543) for drizzle runtime (pgbouncer transaction mode + prepared statements).
- Diagnose reachability with `dns.resolve4()` vs `dns.resolve6()` on the host (parse host without leaking the password).

## 2. Special chars in the DB password break URL parsers
- Supabase auto-generated passwords often contain `/`, `@`, `:` etc. A raw `/` in the password makes `new URL()` AND `pg-connection-string` throw `Invalid URL` — and **drizzle-kit swallows that error** (silent exit 1), so it looks like a connection/permission problem.
- **Why:** passing a connection *string* forces URL parsing/percent-decoding of the password.
- **How to apply:** parse the string MANUALLY into discrete fields and pass `{host,port,user,password,database,ssl}` to `pg.Pool` and to drizzle-kit `dbCredentials` (it accepts discrete fields too). pg does NOT URL-decode discrete fields, so a raw special-char password works as-is. See `lib/db/src/connection.ts` (`resolveDbConfig`). Split on the LAST `@` (password may contain `@`), user on the FIRST `:`, db on the FIRST `/`, port on the LAST `:` of the host section.
- Quick safe diagnosis (never print the value): count `@`/`:`/`/` and check `slashCount` — a normal URL has 3 slashes (`postgresql://` + `/db`); a 4th slash means a `/` is inside the password.

## DB selection without clobbering Replit's managed DATABASE_URL
- The db layer prefers `SUPABASE_DB_URL` and falls back to `DATABASE_URL`. **Why:** Replit's built-in Postgres `DATABASE_URL` can be runtime-managed/re-injected; a separate var is reversible and avoids fighting the platform. Enable TLS (`ssl.rejectUnauthorized:false`) only for supabase hosts.
- Tradeoff the user accepted: moving the DB to Supabase loses Replit's built-in DB rollback/checkpoints and publish-time migration flow; schema is pushed manually via `pnpm --filter @workspace/db run push`.
