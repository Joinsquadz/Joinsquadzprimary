---
name: Drizzle push TTY drift → phantom data loss
description: Why squad/list endpoints 500 and data "disappears" after merges; how to keep drizzle-kit push non-interactive
---

This repo applies schema with `drizzle-kit push` (no migration files). `push` is the migration mechanism.

**Failure mode:** `drizzle-kit push` asks an interactive prompt whenever it must add a UNIQUE constraint to a non-empty table (e.g. "add X_unique unique constraint … truncate table?"). In post-merge / non-TTY runs it throws `Interactive prompts require a TTY` and **aborts the entire push** — so NONE of that run's new tables/columns get created. Repeated merges then silently accumulate schema drift in the live DB.

**Symptom that looks like data loss:** a list endpoint that touches a missing table 500s, so the client renders an empty list. Users report "my squads/events keep getting deleted" but the rows are still in the DB — the read just fails. Example: `GET /api/squads` runs `getMutedSquadIdsForUser()` (reads `squad_mutes`) inside a `Promise.all`; missing `squad_mutes` → whole route 500s → zero squads shown.

**Fix / how to apply:**
- Apply missing DDL via raw SQL (the code_execution `executeSql` sandbox), matching Drizzle's naming exactly (e.g. composite PK `<table>_<col1>_<col2>_pk`, constraint `<table>_<col>_unique`).
- Drizzle models a column `.unique()` as a unique **CONSTRAINT**, not a bare unique **INDEX**. If the DB has only a unique index with that name, push keeps trying to add the constraint and fails forever. Convert: `DROP INDEX x_unique; ALTER TABLE t ADD CONSTRAINT x_unique UNIQUE (col);`. (A `uniqueIndex()` in schema is meant to stay an index — leave those alone.)
- After fixing, run `pnpm --filter @workspace/db run push` from bash: success prints `[✓] Changes applied` with zero prompts. If it still prints a prompt, add that constraint manually and re-run until clean. Once clean, future merges apply schema correctly.
- To enumerate drift: compare `pgTable("name"...)` literals in `lib/db/src/schema/*` against `information_schema.tables`, and check each `.unique()` column has a matching row in `pg_constraint` (not just `pg_indexes`).
