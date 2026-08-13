ALTER TABLE "availability_polls" ADD COLUMN "kind" text DEFAULT 'event' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_polls" ADD COLUMN "trip_length_days" integer;--> statement-breakpoint
-- Backfill the explicit poll type from the old "All day" slot sentinel, which
-- is how trip polls used to be recognised. Only rows whose slots are EXACTLY
-- ["All day"] were trip polls; everything else is an event poll and already has
-- the column default. `trip_length_days` is deliberately NOT backfilled: a
-- legacy trip poll has no recorded trip length, and guessing one would silently
-- change the answer people already voted on. NULL keeps today's
-- single-best-day behaviour for them.
UPDATE "availability_polls" SET "kind" = 'trip' WHERE "slots" = '["All day"]'::jsonb;
