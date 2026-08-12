/**
 * Idempotent schema sync — runs at every server boot.
 *
 * Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout so it is safe to
 * run repeatedly. This covers tables and columns that were added to the
 * Drizzle schema after the initial drizzle-kit push but never migrated to the
 * live databases (dev + production).
 *
 * Keep this file in sync with lib/db/src/schema/**. When you add a new table
 * or column to the schema, add the corresponding IF NOT EXISTS statement here
 * as well so it gets applied on the next deploy without a manual migration run.
 */

import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { logger } from './logger';
import { reconcileFoundingCounter } from './founding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exec(statement: string): Promise<void> {
  await db.execute(sql.raw(statement));
}

async function safeExec(statement: string): Promise<void> {
  try {
    await exec(statement);
  } catch (err: unknown) {
    // Drizzle wraps PG errors in _DrizzleQueryError which is NOT a standard
    // Error subclass in all environments, so we extract the message text via
    // every possible path before checking for "already exists".
    const parts: string[] = [];
    if (err instanceof Error) parts.push(err.message);
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      if (typeof e['message'] === 'string') parts.push(e['message']);
      if (typeof e['query'] === 'string') parts.push(e['query']);
    }
    parts.push(String(err));
    const text = parts.join(' ');
    // "already exists" and "duplicate key" are harmless on subsequent runs.
    if (text.includes('already exists') || text.includes('duplicate')) return;
    // Log but don't rethrow — a single missed constraint/index is not fatal.
    // The outer ensureSchema will still complete the rest of the migration.
  }
}

// ---------------------------------------------------------------------------
// Missing tables
// ---------------------------------------------------------------------------

async function createMissingTables(): Promise<void> {
  await exec(`
    CREATE TABLE IF NOT EXISTS "rate_limits" (
      "key" text PRIMARY KEY NOT NULL,
      "count" integer DEFAULT 1 NOT NULL,
      "window_start" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "revoked_tokens" (
      "token_hash" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
      "expires_at" timestamp with time zone NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "auth_tokens" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL,
      "type" text NOT NULL,
      "token_hash" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "used_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "push_tickets" (
      "ticket_id" text PRIMARY KEY NOT NULL,
      "push_token" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "squad_mutes" (
      "user_id" text NOT NULL,
      "squad_id" text NOT NULL,
      "muted_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "squad_mutes_user_id_squad_id_pk" PRIMARY KEY("user_id","squad_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "squad_removal_notices" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL,
      "squad_name" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "seen_at" timestamp with time zone
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "squad_member_history" (
      "squad_id" text NOT NULL,
      "user_id" text NOT NULL,
      "first_joined_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "squad_member_history_squad_id_user_id_pk" PRIMARY KEY("squad_id","user_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "friend_requests" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "from_user_id" text NOT NULL,
      "to_user_id" text NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "friend_requests_from_to_unique" UNIQUE("from_user_id","to_user_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "event_creations" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL,
      "event_id" text,
      "source" text DEFAULT 'create' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "plan_ideas" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "plan_id" text NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
      "submitted_by_user_id" text NOT NULL,
      "title" text NOT NULL,
      "description" text,
      "category" text DEFAULT 'activity' NOT NULL,
      "link_url" text,
      "estimated_cost" numeric,
      "suggested_date" text,
      "status" text DEFAULT 'pending' NOT NULL,
      "pinned_at" timestamp with time zone,
      "sort_order" integer,
      "nudge_sent_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "idea_votes" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "idea_id" text NOT NULL REFERENCES "plan_ideas"("id") ON DELETE CASCADE,
      "user_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "idea_votes_idea_user_unique" UNIQUE("idea_id","user_id")
    )
  `);

  // Query-aligned indexes for the ideas board: lists filter plan_ideas by
  // plan (+status/date for confirmed-group ordering), and vote counts filter
  // idea_votes by idea. Without these, hot reads become table scans as plans grow.
  await exec(
    `CREATE INDEX IF NOT EXISTS "plan_ideas_plan_status_date_idx" ON "plan_ideas" ("plan_id", "status", "suggested_date")`,
  );
  await exec(
    `CREATE INDEX IF NOT EXISTS "idea_votes_idea_idx" ON "idea_votes" ("idea_id")`,
  );

  await exec(`
    CREATE TABLE IF NOT EXISTS "vault_hearts" (
      "id" serial PRIMARY KEY NOT NULL,
      "photo_id" integer NOT NULL,
      "user_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "vault_comments" (
      "id" serial PRIMARY KEY NOT NULL,
      "photo_id" integer NOT NULL,
      "author_id" text NOT NULL,
      "text" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "deleted_at" timestamp with time zone
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "favorites" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "photo_id" integer NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "feed_posts" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "author_id" text NOT NULL,
      "text" text DEFAULT '' NOT NULL,
      "audience" text NOT NULL,
      "media_url" text,
      "media_type" text,
      "duration_ms" integer,
      "status" text DEFAULT 'active' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "deleted_at" timestamp with time zone
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "feed_comments" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "post_id" text NOT NULL,
      "author_id" text NOT NULL,
      "text" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "deleted_at" timestamp with time zone
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "feed_reactions" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "post_id" text NOT NULL,
      "user_id" text NOT NULL,
      "emoji" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "feed_reactions_post_user_emoji_unique" UNIQUE("post_id","user_id","emoji")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "moments" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "author_id" text NOT NULL,
      "audience" text NOT NULL,
      "media_url" text NOT NULL,
      "media_type" text NOT NULL,
      "duration_ms" integer,
      "status" text DEFAULT 'active' NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      "deleted_at" timestamp with time zone
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "moment_reactions" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "moment_id" text NOT NULL,
      "user_id" text NOT NULL,
      "emoji" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "moment_reactions_moment_user_emoji_unique" UNIQUE("moment_id","user_id","emoji")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "moment_views" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "moment_id" text NOT NULL,
      "viewer_id" text NOT NULL,
      "viewed_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "moment_views_moment_viewer_unique" UNIQUE("moment_id","viewer_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "object_uploads" (
      "object_path" text PRIMARY KEY NOT NULL,
      "owner_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now()
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "founding_member_counter" (
      "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
      "redeemed" integer DEFAULT 0 NOT NULL,
      CONSTRAINT "founding_member_counter_single_row" CHECK ("founding_member_counter"."id" = 1)
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "founding_member_redemptions" (
      "subscription_id" text PRIMARY KEY NOT NULL,
      "redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "squad_invites" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "squad_id" text NOT NULL,
      "inviter_user_id" text NOT NULL,
      "invited_user_id" text NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "squad_name" text DEFAULT '' NOT NULL,
      "squad_emoji" text DEFAULT '👥' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "uniq_squad_invite_per_squad" UNIQUE("squad_id","invited_user_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "event_invites" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "event_id" text NOT NULL,
      "inviter_user_id" text NOT NULL,
      "invited_user_id" text NOT NULL,
      "status" text DEFAULT 'pending' NOT NULL,
      "event_title" text DEFAULT '' NOT NULL,
      "event_emoji" text DEFAULT '🗓️' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "uniq_event_invite_per_event" UNIQUE("event_id","invited_user_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "reports" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "reporter_id" text NOT NULL,
      "content_type" text NOT NULL,
      "content_id" text NOT NULL,
      "target_user_id" text NOT NULL,
      "reason" text NOT NULL,
      "notes" text,
      "status" text DEFAULT 'pending' NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "reports_reporter_content_unique" UNIQUE("reporter_id","content_type","content_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "user_blocks" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "blocker_id" text NOT NULL,
      "blocked_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now(),
      CONSTRAINT "user_blocks_blocker_blocked_unique" UNIQUE("blocker_id","blocked_id")
    )
  `);

  await exec(`
    CREATE TABLE IF NOT EXISTS "activity" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "recipient_id" text NOT NULL,
      "actor_id" text NOT NULL,
      "type" text NOT NULL,
      "subject_type" text,
      "subject_id" text,
      "meta" jsonb,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);

  // Retry queue for storage objects that could not be deleted during account
  // deletion. The DB purge commits regardless of storage availability, so this
  // is what stops a Supabase/R2 outage from silently leaking a deleted user's
  // media. The unique key is the object itself so re-queuing is idempotent.
  await exec(`
    CREATE TABLE IF NOT EXISTS "account_media_cleanup" (
      "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" text NOT NULL,
      "store" text NOT NULL,
      "bucket" text NOT NULL,
      "object_key" text NOT NULL,
      "attempts" integer DEFAULT 0 NOT NULL,
      "last_error" text,
      "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "account_media_cleanup_object_unique" UNIQUE("store","bucket","object_key")
    )
  `);

  // Single-row table tracking the last fully-successful (zero-failure) media
  // backup run. The CHECK constraint guarantees at most one row so there is
  // nothing to paginate or reconcile; UPSERT stamps it on every clean run.
  await exec(`
    CREATE TABLE IF NOT EXISTS "media_backup_status" (
      "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
      "last_success_at" timestamp with time zone,
      "last_summary" jsonb,
      CONSTRAINT "media_backup_status_single_row" CHECK ("id" = 1)
    )
  `);
}

// ---------------------------------------------------------------------------
// Missing columns on existing tables
// ---------------------------------------------------------------------------

async function addMissingColumns(): Promise<void> {
  const alterColumns: string[] = [
    // users
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notify_payments" boolean DEFAULT true NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "venmo_handle" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cashapp_handle" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "zelle_handle" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hometown" text`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activity_last_read_at" timestamp with time zone`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderation_hidden" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_squadz_plus" boolean DEFAULT false NOT NULL`,
    // Makes RevenueCat entitlement writes monotonic against unordered webhook
    // delivery. Text (not bigint) so it round-trips as a JS string without
    // precision surprises; null = no period-bearing event applied yet.
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "squadz_plus_period_end_ms" text`,
    // Age gate (13+). Nullable on purpose: existing accounts predate the gate,
    // so NULL = "never age-checked" and must stay distinguishable from false.
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "meets_min_age" boolean`,
    `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "birth_year" integer`,
    // photos
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'image' NOT NULL`,
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "caption" text`,
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL`,
    // Personal "Save to my vault" copies point back at their source photo.
    // Deliberately NO foreign key: the copy must survive the source's deletion.
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "saved_from_photo_id" integer`,
    // event_creations now records JOINS as well as creations.
    `ALTER TABLE "event_creations" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'create' NOT NULL`,
    // events
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'event' NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "event_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "start_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "end_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "all_day" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "cover_style" text DEFAULT '' NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "co_admin_ids" jsonb DEFAULT '[]'::jsonb NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "itinerary" jsonb DEFAULT '[]'::jsonb NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "packing" jsonb DEFAULT '[]'::jsonb NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "invited_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "timezone" text`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "day_of_reminder_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "remind_3_days_toggle" boolean DEFAULT true NOT NULL`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "three_day_reminder_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "manual_reminder_general_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "manual_reminder_rsvp_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "recap_prompt_sent_at" timestamp with time zone`,
    `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "material_edit_notified_at" timestamp with time zone`,
    // squads
    `ALTER TABLE "squads" ADD COLUMN IF NOT EXISTS "members_can_invite" boolean DEFAULT false NOT NULL`,
    `ALTER TABLE "squads" ADD COLUMN IF NOT EXISTS "invite_code" text`,
    `ALTER TABLE "squads" ADD COLUMN IF NOT EXISTS "invite_code_expires_at" timestamp with time zone`,
    `ALTER TABLE "squads" ADD COLUMN IF NOT EXISTS "co_admin_ids" jsonb DEFAULT '[]'::jsonb NOT NULL`,
    `ALTER TABLE "squads" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL`,
    // availability_polls
    `ALTER TABLE "availability_polls" ADD COLUMN IF NOT EXISTS "participant_ids" jsonb`,
    `ALTER TABLE "availability_polls" ADD COLUMN IF NOT EXISTS "nudge_sent_at" timestamp with time zone`,
    `ALTER TABLE "availability_polls" ADD COLUMN IF NOT EXISTS "converted_event_id" text`,
    `ALTER TABLE "availability_polls" ADD COLUMN IF NOT EXISTS "poll_update_notified_at" timestamp with time zone`,
    // conversation_messages
    `ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'visible' NOT NULL`,
    // conversations — per-plan (event/trip) chat threads
    `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "event_id" text`,
  ];

  for (const stmt of alterColumns) {
    await exec(stmt);
  }
}

// ---------------------------------------------------------------------------
// Indexes and FK constraints (safe = wrapped in safeExec)
// ---------------------------------------------------------------------------

async function createIndexes(): Promise<void> {
  const indexes: string[] = [
    `CREATE INDEX IF NOT EXISTS "IDX_revoked_tokens_expires_at" ON "revoked_tokens"("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_auth_tokens_token_hash" ON "auth_tokens"("token_hash")`,
    `CREATE INDEX IF NOT EXISTS "IDX_auth_tokens_user_id" ON "auth_tokens"("user_id")`,
    `CREATE INDEX IF NOT EXISTS "idx_push_tickets_created_at" ON "push_tickets"("created_at")`,
    `CREATE INDEX IF NOT EXISTS "squad_member_history_user_idx" ON "squad_member_history"("user_id")`,
    `CREATE INDEX IF NOT EXISTS "event_creations_user_created_idx" ON "event_creations"("user_id","created_at")`,
    // Makes a plan slot idempotent per (user, plan): re-accepting an invite or
    // re-RSVPing never charges twice. The join-side ON CONFLICT depends on it.
    `CREATE UNIQUE INDEX IF NOT EXISTS "event_creations_user_event_unique" ON "event_creations"("user_id","event_id")`,
    // Personal vault saves: "have I already saved this source photo?" — UNIQUE
    // so two simultaneous saves (which both pass the "already saved?" probe)
    // cannot insert two copies; the save's ON CONFLICT targets it. NULLs are
    // distinct in Postgres, so ordinary uploads are unaffected. Duplicates are
    // collapsed just above before this runs.
    `CREATE UNIQUE INDEX IF NOT EXISTS "photos_uploader_saved_from_uq" ON "photos"("uploader_id","saved_from_photo_id")`,
    `DROP INDEX IF EXISTS "photos_uploader_saved_from_idx"`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "vault_hearts_photo_user_unique" ON "vault_hearts"("photo_id","user_id")`,
    `CREATE INDEX IF NOT EXISTS "vault_comments_photo_idx" ON "vault_comments"("photo_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_photo_unique" ON "favorites"("user_id","photo_id")`,
    // Exactly one chat thread per plan. This index is not just a guard: the
    // get-or-create path and the legacy-chat backfill both rely on it for
    // ON CONFLICT ("event_id") DO NOTHING, so two concurrent opens converge on
    // one thread instead of erroring out. NULLs are distinct in Postgres, so
    // every non-plan conversation is unaffected.
    `CREATE UNIQUE INDEX IF NOT EXISTS "conversations_event_id_unique" ON "conversations"("event_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_feed_comments_post_id" ON "feed_comments"("post_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_feed_posts_author_id" ON "feed_posts"("author_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_feed_posts_audience" ON "feed_posts"("audience")`,
    `CREATE INDEX IF NOT EXISTS "IDX_feed_posts_created_at" ON "feed_posts"("created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_feed_reactions_post_id" ON "feed_reactions"("post_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_moment_reactions_moment_id" ON "moment_reactions"("moment_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_moment_views_moment_id" ON "moment_views"("moment_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_moments_author_id" ON "moments"("author_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_moments_audience" ON "moments"("audience")`,
    `CREATE INDEX IF NOT EXISTS "IDX_moments_expires_at" ON "moments"("expires_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_activity_recipient_created" ON "activity"("recipient_id","created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_activity_recipient_actor_subject" ON "activity"("recipient_id","actor_id","type","subject_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_reports_reporter_id" ON "reports"("reporter_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_reports_target_user_id" ON "reports"("target_user_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_reports_content" ON "reports"("content_type","content_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_reports_created_at" ON "reports"("created_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_reports_status" ON "reports"("status")`,
    `CREATE INDEX IF NOT EXISTS "IDX_user_blocks_blocker_id" ON "user_blocks"("blocker_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_user_blocks_blocked_id" ON "user_blocks"("blocked_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_account_media_cleanup_next_attempt" ON "account_media_cleanup"("next_attempt_at")`,
    `CREATE INDEX IF NOT EXISTS "IDX_object_uploads_owner_id" ON "object_uploads"("owner_id")`,
    // Hot-path query indexes added post-launch (scale hardening).
    // squads.member_ids: @> containment operator used by getSquadIdsForUser and
    // GET /squads; without GIN this is a full sequential scan.
    // CONCURRENTLY: GIN builds scan the full column and can take seconds on a
    // growing table; CONCURRENTLY avoids holding an AccessExclusiveLock during
    // the build so reads/writes continue normally through a rolling deploy.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_squads_member_ids_gin" ON "squads" USING GIN("member_ids")`,
    // events: visibility filter columns hit on every GET /events request.
    `CREATE INDEX IF NOT EXISTS "IDX_events_squad_id" ON "events"("squad_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_events_host_id" ON "events"("host_id")`,
    `CREATE INDEX IF NOT EXISTS "IDX_events_event_at" ON "events"("event_at")`,
    // events JSONB containment (@> / ?) for rsvps and invitedUserIds visibility.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_events_rsvps_gin" ON "events" USING GIN("rsvps")`,
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_events_invited_user_ids_gin" ON "events" USING GIN("invited_user_ids")`,
  ];

  for (const stmt of indexes) {
    await safeExec(stmt);
  }
}

async function createForeignKeys(): Promise<void> {
  const fks: string[] = [
    `ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk"
       FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade`,
    `ALTER TABLE "vault_hearts" ADD CONSTRAINT "vault_hearts_photo_id_photos_id_fk"
       FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "vault_comments" ADD CONSTRAINT "vault_comments_photo_id_photos_id_fk"
       FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "favorites" ADD CONSTRAINT "favorites_photo_id_photos_id_fk"
       FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_post_id_feed_posts_id_fk"
       FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_post_id_feed_posts_id_fk"
       FOREIGN KEY ("post_id") REFERENCES "feed_posts"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "moment_reactions" ADD CONSTRAINT "moment_reactions_moment_id_moments_id_fk"
       FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE cascade NOT VALID`,
    `ALTER TABLE "moment_views" ADD CONSTRAINT "moment_views_moment_id_moments_id_fk"
       FOREIGN KEY ("moment_id") REFERENCES "moments"("id") ON DELETE cascade NOT VALID`,
    // Per-plan chat threads die with their plan. Without this cascade every
    // event-delete call site (host account deletion, squad teardown, plain
    // delete) would have to remember to purge the thread by hand.
    `ALTER TABLE "conversations" ADD CONSTRAINT "conversations_event_id_events_id_fk"
       FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE cascade NOT VALID`,
  ];

  for (const stmt of fks) {
    await safeExec(stmt);
  }
}

// ---------------------------------------------------------------------------
// One-time data backfills (idempotent — safe to re-run every boot)
// ---------------------------------------------------------------------------

/**
 * The free-tier caps changed from "live membership / creations only" to
 * "append-only slots". Two ledgers therefore need seeding from the state that
 * predates them. Both statements are idempotent: ON CONFLICT DO NOTHING plus a
 * NOT EXISTS guard means re-running on every boot is a cheap no-op once the
 * rows are in place.
 */
async function backfillLimitLedgers(): Promise<void> {
  // 1. squad_member_history — every CURRENT membership must have a history row,
  //    otherwise existing members would look like they had spent zero slots.
  //    (History rows for squads people already left cannot be recovered; those
  //    users simply keep the slot they no longer occupy, which is the generous
  //    direction and matches "existing users keep what they have".)
  await safeExec(`
    INSERT INTO "squad_member_history" ("squad_id", "user_id")
    SELECT s."id", m."user_id"
    FROM "squads" s
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(s."member_ids", '[]'::jsonb)) AS m("user_id")
    ON CONFLICT DO NOTHING
  `);

  // 2. event_creations — the ledger only ever recorded CREATES. Joining now
  //    consumes a slot too, so seed accepted invites and "going" RSVPs that
  //    already happened. Without this an existing user's usage would read low
  //    and then jump the first time they touch a plan.
  //    The unique (user_id, event_id) index makes both inserts idempotent, and
  //    a creator who also RSVP'd keeps exactly one row.
  await safeExec(`
    INSERT INTO "event_creations" ("user_id", "event_id", "source", "created_at")
    SELECT i."invited_user_id", i."event_id", 'join', i."created_at"
    FROM "event_invites" i
    WHERE i."status" = 'accepted'
    ON CONFLICT ("user_id", "event_id") DO NOTHING
  `);
  await safeExec(`
    INSERT INTO "event_creations" ("user_id", "event_id", "source", "created_at")
    SELECT r."user_id", e."id", 'join', COALESCE(e."created_at", now())
    FROM "events" e
    CROSS JOIN LATERAL jsonb_each_text(COALESCE(e."rsvps", '{}'::jsonb)) AS r("user_id", "status")
    WHERE r."status" = 'going'
    ON CONFLICT ("user_id", "event_id") DO NOTHING
  `);
}

/**
 * The (user_id, event_id) unique index can only be created once any pre-existing
 * duplicates are collapsed. Duplicates should not exist (creation wrote one row
 * per event) but a NULL event_id row or a legacy double-create would block the
 * index and silently break every ON CONFLICT that depends on it.
 */
async function dedupeEventCreations(): Promise<void> {
  await safeExec(`
    DELETE FROM "event_creations" a
    USING "event_creations" b
    WHERE a."event_id" IS NOT NULL
      AND a."user_id" = b."user_id"
      AND a."event_id" = b."event_id"
      AND a."created_at" > b."created_at"
  `);
}

/**
 * Same story for the personal-vault saves index: the unique
 * (uploader_id, saved_from_photo_id) index cannot be created while duplicate
 * copies exist. Duplicates are only possible from saves that raced before the
 * constraint existed; keep the OLDEST copy of each pair (the one whose id the
 * client is most likely already showing) and drop the rest.
 *
 * Only the ROWS go here. The losing rows' storage objects stay put — their
 * object_uploads provenance still names the saver, so account deletion and the
 * media-cleanup queue can still reach them. Deleting bytes from a schema
 * migration would be the wrong place to risk it.
 */
async function dedupeSavedPhotoCopies(): Promise<void> {
  await safeExec(`
    DELETE FROM "photos" a
    USING "photos" b
    WHERE a."saved_from_photo_id" IS NOT NULL
      AND a."uploader_id" = b."uploader_id"
      AND a."saved_from_photo_id" = b."saved_from_photo_id"
      AND a."id" > b."id"
  `);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function ensureSchema(): Promise<void> {
  // Allow staging/CI environments where the schema is already in place to skip
  // the sync entirely. Never set this in production.
  if (process.env.SKIP_SCHEMA_SYNC) {
    logger.info('[schemaSync] Skipping schema sync (SKIP_SCHEMA_SYNC is set)');
    return;
  }
  try {
    logger.info('[schemaSync] Running startup schema sync…');
    await createMissingTables();
    await addMissingColumns();
    // Duplicates must go before createIndexes(), which adds the unique
    // (user_id, event_id) index the plan-slot ledger's ON CONFLICT relies on.
    await dedupeEventCreations();
    await dedupeSavedPhotoCopies();
    await createIndexes();
    await createForeignKeys();
    await backfillLimitLedgers();
    logger.info('[schemaSync] Schema sync complete');
    // Heal any counter drift caused by webhooks that fired before the
    // founding_member_counter / founding_member_redemptions tables existed.
    await reconcileFoundingCounter();
  } catch (err) {
    // A schema sync failure is serious but should not prevent the server from
    // starting — routes that depend on missing tables will 500, but the rest
    // of the app stays available. The error is logged prominently so it is
    // not missed in monitoring.
    logger.error({ err }, '[schemaSync] Schema sync FAILED — some features may be unavailable');
  }
}
