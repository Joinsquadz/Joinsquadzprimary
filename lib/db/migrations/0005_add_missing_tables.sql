CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revoked_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "friend_requests_from_to_unique" UNIQUE("from_user_id","to_user_id")
);
--> statement-breakpoint
CREATE TABLE "event_creations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_member_history" (
	"squad_id" text NOT NULL,
	"user_id" text NOT NULL,
	"first_joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_member_history_squad_id_user_id_pk" PRIMARY KEY("squad_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "vault_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vault_hearts" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"photo_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_comments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feed_posts" (
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
);
--> statement-breakpoint
CREATE TABLE "feed_reactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "feed_reactions_post_user_emoji_unique" UNIQUE("post_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "moment_reactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "moment_reactions_moment_user_emoji_unique" UNIQUE("moment_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "moment_views" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moment_id" text NOT NULL,
	"viewer_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "moment_views_moment_viewer_unique" UNIQUE("moment_id","viewer_id")
);
--> statement-breakpoint
CREATE TABLE "moments" (
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
);
--> statement-breakpoint
CREATE TABLE "object_uploads" (
	"object_path" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "founding_member_counter" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"redeemed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "founding_member_counter_single_row" CHECK ("founding_member_counter"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "founding_member_redemptions" (
	"subscription_id" text PRIMARY KEY NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_invites" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invited_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"squad_name" text DEFAULT '' NOT NULL,
	"squad_emoji" text DEFAULT '👥' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_squad_invite_per_squad" UNIQUE("squad_id","invited_user_id")
);
--> statement-breakpoint
CREATE TABLE "event_invites" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invited_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"event_title" text DEFAULT '' NOT NULL,
	"event_emoji" text DEFAULT '🗓️' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_event_invite_per_event" UNIQUE("event_id","invited_user_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
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
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_blocks_blocker_blocked_unique" UNIQUE("blocker_id","blocked_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_squadz_plus" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hometown" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "activity_last_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "type" text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "all_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_style" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "co_admin_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "itinerary" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "packing" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "invited_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "day_of_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "remind_3_days_toggle" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "three_day_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "manual_reminder_general_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "manual_reminder_rsvp_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recap_prompt_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "material_edit_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squads" ADD COLUMN "co_admin_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "squads" ADD COLUMN "invite_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "media_type" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_polls" ADD COLUMN "participant_ids" jsonb;--> statement-breakpoint
ALTER TABLE "availability_polls" ADD COLUMN "nudge_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "availability_polls" ADD COLUMN "converted_event_id" text;--> statement-breakpoint
ALTER TABLE "availability_polls" ADD COLUMN "poll_update_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "status" text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_comments" ADD CONSTRAINT "vault_comments_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_hearts" ADD CONSTRAINT "vault_hearts_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_post_id_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."feed_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_reactions" ADD CONSTRAINT "moment_reactions_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moment_views" ADD CONSTRAINT "moment_views_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_revoked_tokens_expires_at" ON "revoked_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "event_creations_user_created_idx" ON "event_creations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "squad_member_history_user_idx" ON "squad_member_history" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vault_comments_photo_idx" ON "vault_comments" USING btree ("photo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_hearts_photo_user_unique" ON "vault_hearts" USING btree ("photo_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_user_photo_unique" ON "favorites" USING btree ("user_id","photo_id");--> statement-breakpoint
CREATE INDEX "IDX_feed_comments_post_id" ON "feed_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "IDX_feed_posts_author_id" ON "feed_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "IDX_feed_posts_audience" ON "feed_posts" USING btree ("audience");--> statement-breakpoint
CREATE INDEX "IDX_feed_posts_created_at" ON "feed_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "IDX_feed_reactions_post_id" ON "feed_reactions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "IDX_moment_reactions_moment_id" ON "moment_reactions" USING btree ("moment_id");--> statement-breakpoint
CREATE INDEX "IDX_moment_views_moment_id" ON "moment_views" USING btree ("moment_id");--> statement-breakpoint
CREATE INDEX "IDX_moments_author_id" ON "moments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "IDX_moments_audience" ON "moments" USING btree ("audience");--> statement-breakpoint
CREATE INDEX "IDX_moments_expires_at" ON "moments" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "IDX_activity_recipient_created" ON "activity" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "IDX_activity_recipient_actor_subject" ON "activity" USING btree ("recipient_id","actor_id","type","subject_id");--> statement-breakpoint
CREATE INDEX "IDX_reports_reporter_id" ON "reports" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "IDX_reports_target_user_id" ON "reports" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "IDX_reports_content" ON "reports" USING btree ("content_type","content_id");--> statement-breakpoint
CREATE INDEX "IDX_reports_created_at" ON "reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "IDX_reports_status" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "IDX_user_blocks_blocker_id" ON "user_blocks" USING btree ("blocker_id");--> statement-breakpoint
CREATE INDEX "IDX_user_blocks_blocked_id" ON "user_blocks" USING btree ("blocked_id");