---
name: Schema sync gap — missing tables & startup migration
description: Many Drizzle schema tables/columns were never pushed to dev or prod DBs; a schemaSync module now handles this at every boot.
---

## The rule

`lib/db/migrations/` is NOT automatically applied at startup. Tables added to the Drizzle schema after the initial `drizzle-kit push` will be silently missing from the DB until either another push runs or the `schemaSync` startup module covers them.

**Any new table or column added to `lib/db/src/schema/**` MUST also be added to `artifacts/api-server/src/lib/schemaSync.ts`** with an `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` guard. This is the single source of live-DB migrations.

## Why

`drizzle-kit push` has TTY drift issues (aborts on unique-constraint prompts in non-interactive CI/deploy environments). The team used it once to bootstrap and never re-ran it. Subsequent schema additions were Drizzle-only and never hit the DB.

## How to apply

1. Add `CREATE TABLE IF NOT EXISTS …` in `createMissingTables()` in `schemaSync.ts`.
2. Add `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` in `addMissingColumns()`.
3. Add indexes in `createIndexes()`, FK constraints in `createForeignKeys()`.
4. All run via `safeExec` (swallows "already exists") — fully idempotent.

## What was missing (fixed in this session)

New tables created: `favorites`, `vault_hearts`, `vault_comments`, `feed_posts`, `feed_comments`, `feed_reactions`, `moments`, `moment_reactions`, `moment_views`, `object_uploads`, `founding_member_counter`, `founding_member_redemptions`, `squad_invites`, `event_invites`, `reports`, `user_blocks`, `friend_requests`, `event_creations`, `squad_member_history`, `activity`, `rate_limits`, `revoked_tokens`, `auth_tokens`, `push_tickets`, `squad_mutes`, `squad_removal_notices`.

New columns added on existing tables: `users.is_squadz_plus`, `photos.media_type/caption/status`, `events.type/event_at/start_at/end_at/all_day/cover_style/co_admin_ids/itinerary/packing/invited_user_ids/timezone/reminder*_sent_at/version`, `squads.co_admin_ids/version/members_can_invite/invite_code`, `availability_polls.participant_ids/nudge_sent_at/converted_event_id/poll_update_notified_at`, `conversation_messages.status`.

## The duplication is deliberate — keep both in step

`schemaSync.ts` and `lib/db/migrations/` intentionally describe the same schema:
the API does not run the Drizzle migrator at boot, so schemaSync is what actually
reaches the live DB, while the migration history is what a FRESH database gets.
Neither can be dropped until the API runs the migrator at startup.

**Why:** the two drifted badly — a migration snapshot claimed the whole schema
when its SQL only added one column, and a long tail of tables/columns/indexes
existed solely in schemaSync. A fresh migrations-only bootstrap therefore
produced a database the app could not run against, which is invisible in dev
because dev has been repaired in place by schemaSync for months.

**How to apply:** a new table/column goes in BOTH. Prove the migration path still
stands up on its own with the db package's `validate-migrations` script. Never
hand-edit a snapshot to silence it; add a repair migration instead.

## What makes a drift check trustworthy

Presence-only checking (does the table/column exist?) is close to worthless
here — the drift that actually bites is constraint names, indexes and delete
rules, and one-directional checking passes while objects exist that no snapshot
declares.

**Why:** a presence-only validator reported a clean schema while two indexes
lived only in schemaSync and two foreign keys had names the snapshot disagreed
with. Both classes are invisible unless you compare metadata in both directions.

**How to apply:** compare columns (type/nullability/default), primary keys,
unique and check constraints, foreign keys including ON DELETE, and indexes —
and fail on UNEXPECTED objects, not just missing ones. Normalize the spellings
that legitimately differ between Drizzle and Postgres (`timestamp` vs
`timestamp without time zone`, `serial` vs `integer`, boolean/cast rendering in
defaults) or the check cries wolf.

## Validation must own its database

A migration validator may not run inside a database that already has objects.

**Why:** the migrations contain schema-qualified `REFERENCES "public"."…"`, so
running them under a redirected `search_path` binds foreign keys to whatever is
already in `public` rather than to the schema under test. The run then reports a
pass that proves nothing. Refuse rather than degrade: no CREATE DATABASE means
no validation.

**How to apply:** create a uniquely-named scratch database, verify it is empty
before diffing, drop it afterwards. Related: any idempotent `DO $$` block that
inspects `pg_constraint` must scope the lookup to the owning table (`conrelid`),
since constraint names are unique per table, not per database.

## Inline REFERENCES vs named constraints

Writing `"col" text NOT NULL REFERENCES "other"("id")` inline lets Postgres
auto-name the constraint `<table>_<col>_fkey`. Drizzle names the same key
`<table>_<col>_<target>_<targetcol>_fk` and generates all future migrations
against ITS name.

**Why:** schemaSync used the inline form, so live databases had `_fkey` while the
snapshot expected `_fk`. A fresh build and a live database were permanently
different schemas, and drizzle could emit migrations targeting a constraint name
that did not exist.

**How to apply:** always declare FKs as NAMED constraints in schemaSync, matching
Drizzle's convention. When correcting an existing one, `RENAME CONSTRAINT` inside
an idempotent, table-scoped `DO $$` block so live databases converge instead of
accumulating a second constraint. The strongest end-to-end proof that schema,
snapshot and migrations agree is `drizzle-kit generate` reporting "No schema
changes, nothing to migrate".

## Root cause of vault "please try again"

`GET /api/squads/:id/vault` calls `storage.getUserFavoritePhotoIds()` which queries the `favorites` table. Table didn't exist → 500 → client showed retry state.
