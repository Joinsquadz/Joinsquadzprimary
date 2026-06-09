ALTER TABLE "users" ADD COLUMN "notify_payments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "venmo_handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cashapp_handle" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "zelle_handle" text;