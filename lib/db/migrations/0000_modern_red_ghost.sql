CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"first_name" text,
	"last_name" text,
	"profile_image_url" text,
	"password_hash" text,
	"phone" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"calendar_sync_enabled" boolean DEFAULT false NOT NULL,
	"calendar_token" text,
	"notify_event_invites" boolean DEFAULT true NOT NULL,
	"notify_reminders" boolean DEFAULT true NOT NULL,
	"notify_messages" boolean DEFAULT true NOT NULL,
	"notify_friend_activity" boolean DEFAULT true NOT NULL,
	"notify_squad_join" boolean DEFAULT true NOT NULL,
	"notify_squad_leave" boolean DEFAULT true NOT NULL,
	"private_profile" boolean DEFAULT false NOT NULL,
	"show_rsvp_activity" boolean DEFAULT true NOT NULL,
	"push_token" text,
	"friend_code" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_friend_code_unique" UNIQUE("friend_code")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"friend_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "friendships_owner_friend_unique" UNIQUE("owner_id","friend_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"emoji" text DEFAULT '🎉' NOT NULL,
	"title" text NOT NULL,
	"date" text NOT NULL,
	"location" text NOT NULL,
	"squad_id" text DEFAULT '' NOT NULL,
	"squad_name" text DEFAULT 'Personal' NOT NULL,
	"host_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"invite_code" text NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"budget" numeric,
	"rsvps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"polls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "squad_mutes" (
	"user_id" text NOT NULL,
	"squad_id" text NOT NULL,
	"muted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_mutes_user_id_squad_id_pk" PRIMARY KEY("user_id","squad_id")
);
--> statement-breakpoint
CREATE TABLE "squads" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"emoji" text DEFAULT '👥' NOT NULL,
	"color" text DEFAULT '#FF5C3A' NOT NULL,
	"member_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"creator_id" text,
	"members_can_invite" boolean DEFAULT false NOT NULL,
	"invite_code" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "squads_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" text,
	"uploader_id" text NOT NULL,
	"url" text NOT NULL,
	"squad_id" text,
	"shared_to_squad" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "availability_nudges" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" text NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_nudges_poll_target_uniq" UNIQUE("poll_id","to_user_id")
);
--> statement-breakpoint
CREATE TABLE "availability_polls" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"squad_id" text,
	"event_id" text,
	"created_by" text NOT NULL,
	"title" text DEFAULT 'Find the Best Time' NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slots" jsonb DEFAULT '["6PM","7PM","8PM","9PM","10PM"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "availability_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"poll_id" text NOT NULL,
	"user_id" text NOT NULL,
	"cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_responses_poll_user_uniq" UNIQUE("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "waitlist" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"source" text DEFAULT 'web-landing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"sender_id" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"squad_id" text,
	"direct_key" text,
	"created_by" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"last_message_sender_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_removal_notices" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"squad_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "push_tickets" (
	"ticket_id" text PRIMARY KEY NOT NULL,
	"push_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_nudges" ADD CONSTRAINT "availability_nudges_poll_id_availability_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."availability_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_responses" ADD CONSTRAINT "availability_responses_poll_id_availability_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."availability_polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_auth_tokens_token_hash" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "IDX_auth_tokens_user_id" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "conversation_messages_convo_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participants_convo_user_unique" ON "conversation_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_user_idx" ON "conversation_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_key_unique" ON "conversations" USING btree ("direct_key");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_squad_id_unique" ON "conversations" USING btree ("squad_id");--> statement-breakpoint
CREATE INDEX "idx_push_tickets_created_at" ON "push_tickets" USING btree ("created_at");