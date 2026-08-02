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

## Root cause of vault "please try again"

`GET /api/squads/:id/vault` calls `storage.getUserFavoritePhotoIds()` which queries the `favorites` table. Table didn't exist → 500 → client showed retry state.
