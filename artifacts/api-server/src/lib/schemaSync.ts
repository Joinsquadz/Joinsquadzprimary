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
    // photos
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "media_type" text DEFAULT 'image' NOT NULL`,
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "caption" text`,
    `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL`,
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
    `CREATE UNIQUE INDEX IF NOT EXISTS "vault_hearts_photo_user_unique" ON "vault_hearts"("photo_id","user_id")`,
    `CREATE INDEX IF NOT EXISTS "vault_comments_photo_idx" ON "vault_comments"("photo_id")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "favorites_user_photo_unique" ON "favorites"("user_id","photo_id")`,
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
  ];

  for (const stmt of fks) {
    await safeExec(stmt);
  }
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
    await createIndexes();
    await createForeignKeys();
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
