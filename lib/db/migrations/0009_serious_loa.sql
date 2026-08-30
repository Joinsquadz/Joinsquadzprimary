DO $$
DECLARE oversized_bios integer;
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'users'
			AND column_name = 'bio'
			AND data_type = 'character varying'
			AND character_maximum_length = 150
	) THEN
		RETURN;
	END IF;

	SELECT count(*) INTO oversized_bios
	FROM "users"
	WHERE char_length("bio") > 150;

	IF oversized_bios = 0 THEN
		ALTER TABLE "users" ALTER COLUMN "bio" TYPE varchar(150);
	ELSE
		RAISE WARNING 'Skipped users.bio varchar(150) conversion: % oversized rows', oversized_bios;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthdate" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hobbies" text[];