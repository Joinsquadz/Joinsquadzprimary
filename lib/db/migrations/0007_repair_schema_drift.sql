-- Repair migration: bring the migration chain back in line with the Drizzle
-- schema.
--
-- Why this exists: this project bootstraps live databases from
-- artifacts/api-server/src/lib/schemaSync.ts (`ensureSchema`) at every boot, and
-- several objects were only ever added there. The 0006 SNAPSHOT was regenerated
-- against a schemaSync'd database, so it claimed three tables and six columns
-- that no migration SQL in this folder ever created. A database built from
-- migrations alone therefore came out incomplete while the snapshot insisted it
-- was current — meaning `drizzle-kit generate` would never emit the missing
-- objects either.
--
-- 0006's snapshot has been narrowed to exactly what its own SQL does (add
-- users.squadz_plus_tier). This migration carries the rest of the drift, so
-- migrations alone now reproduce the full schema.
--
-- Every statement is IF NOT EXISTS / conditional: live databases already have
-- all of this from schemaSync, so applying this file there is a no-op.

CREATE TABLE IF NOT EXISTS "plan_ideas" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" text NOT NULL,
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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idea_votes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idea_votes_idea_user_unique" UNIQUE("idea_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "media_backup_status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_summary" jsonb,
	CONSTRAINT "media_backup_status_single_row" CHECK ("id" = 1)
);
--> statement-breakpoint
-- Foreign keys for the ideas tables, added as NAMED constraints.
--
-- schemaSync creates these inline (`REFERENCES ...` in the column definition),
-- which lets Postgres auto-name them "<table>_<column>_fkey". Drizzle expects
-- "<table>_<column>_<target>_<targetcol>_fk" and generates future migrations
-- against that name, so the two spellings must be reconciled or every fresh
-- build disagrees with the snapshot. Live databases get the constraint renamed;
-- fresh ones get it created.
--
-- Every catalog lookup below is scoped to the OWNING TABLE (conrelid) rather
-- than matching a bare constraint name: constraint names are only unique per
-- table, so an unqualified `WHERE conname = ...` can match an unrelated table
-- in another schema and make this block take the wrong branch.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.plan_ideas'::regclass
                AND conname = 'plan_ideas_plan_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.plan_ideas'::regclass
                AND conname = 'plan_ideas_plan_id_events_id_fk') THEN
    ALTER TABLE "public"."plan_ideas"
      RENAME CONSTRAINT "plan_ideas_plan_id_fkey" TO "plan_ideas_plan_id_events_id_fk";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.plan_ideas'::regclass
                AND conname = 'plan_ideas_plan_id_events_id_fk') THEN
    ALTER TABLE "public"."plan_ideas" ADD CONSTRAINT "plan_ideas_plan_id_events_id_fk"
      FOREIGN KEY ("plan_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.idea_votes'::regclass
                AND conname = 'idea_votes_idea_id_fkey')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.idea_votes'::regclass
                AND conname = 'idea_votes_idea_id_plan_ideas_id_fk') THEN
    ALTER TABLE "public"."idea_votes"
      RENAME CONSTRAINT "idea_votes_idea_id_fkey" TO "idea_votes_idea_id_plan_ideas_id_fk";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.idea_votes'::regclass
                AND conname = 'idea_votes_idea_id_plan_ideas_id_fk') THEN
    ALTER TABLE "public"."idea_votes" ADD CONSTRAINT "idea_votes_idea_id_plan_ideas_id_fk"
      FOREIGN KEY ("idea_id") REFERENCES "public"."plan_ideas"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_ideas_plan_status_date_idx" ON "plan_ideas" ("plan_id","status","suggested_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idea_votes_idea_idx" ON "idea_votes" ("idea_id");
--> statement-breakpoint
-- Age gate (13+). Nullable: accounts predating the gate must stay
-- distinguishable from ones checked and failed.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "meets_min_age" boolean;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "birth_year" integer;
--> statement-breakpoint
-- Makes RevenueCat entitlement writes monotonic against unordered webhook
-- delivery. Text (not bigint) so it round-trips as a JS string.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "squadz_plus_period_end_ms" text;
--> statement-breakpoint
ALTER TABLE "event_creations" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'create' NOT NULL;
--> statement-breakpoint
-- Personal "save to my vault" copies point back at their source photo.
-- Deliberately NO foreign key: the copy must survive the source's deletion.
ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "saved_from_photo_id" integer;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "event_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_events_squad_id" ON "events" ("squad_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_events_host_id" ON "events" ("host_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_events_event_at" ON "events" ("event_at");
--> statement-breakpoint
-- These three unique indexes are what make the corresponding ON CONFLICT
-- clauses work (plan-slot ledger, vault save dedupe, plan-chat conversation
-- upsert). On a live database schemaSync de-duplicates any pre-existing rows
-- before creating them; on a fresh database there is nothing to clean.
CREATE UNIQUE INDEX IF NOT EXISTS "event_creations_user_event_unique" ON "event_creations" ("user_id","event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "photos_uploader_saved_from_uq" ON "photos" ("uploader_id","saved_from_photo_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversations_event_id_unique" ON "conversations" ("event_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "conversations" ADD CONSTRAINT "conversations_event_id_events_id_fk"
		FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE cascade NOT VALID;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
