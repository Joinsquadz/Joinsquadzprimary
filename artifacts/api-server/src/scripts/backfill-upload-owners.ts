/**
 * One-off backfill: restore object_uploads provenance records for existing
 * vault photos that were uploaded before the object_uploads table existed.
 *
 * For every row in `photos` whose URL is a private object path (not a public
 * https:// URL), we insert a row into `object_uploads` mapping that path back
 * to its uploader. ON CONFLICT DO NOTHING keeps it safe to re-run.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run backfill:upload-owners
 */

import { db, photosTable, objectUploadsTable } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Fetching all photos from the database…");

  const photos = await db
    .select({
      id: photosTable.id,
      uploaderId: photosTable.uploaderId,
      url: photosTable.url,
    })
    .from(photosTable);

  console.log(`Found ${photos.length} photo row(s) total.`);

  // Only backfill private object paths — public https:// URLs are not gated by
  // the upload-owner check (vault.ts verifyProvenance returns true for them).
  const privatePaths = photos.filter((p) => !/^https?:\/\//i.test(p.url));

  console.log(
    `${privatePaths.length} row(s) have private object paths and need provenance records.`,
  );

  if (privatePaths.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Insert in batches of 500 to avoid oversized parameter lists.
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < privatePaths.length; i += BATCH_SIZE) {
    const batch = privatePaths.slice(i, i + BATCH_SIZE);
    const values = batch.map((p) => ({
      objectPath: p.url,
      ownerId: p.uploaderId,
    }));

    const result = await db
      .insert(objectUploadsTable)
      .values(values)
      .onConflictDoNothing({ target: objectUploadsTable.objectPath });

    // Drizzle doesn't expose rowsAffected for pg inserts directly via the
    // fluent API, so we track via the batch size as an upper bound and verify
    // separately if needed.
    inserted += batch.length;
    console.log(
      `  Processed batch ${Math.floor(i / BATCH_SIZE) + 1}: rows ${i + 1}–${Math.min(i + BATCH_SIZE, privatePaths.length)}`,
    );
  }

  console.log(`Backfill complete. Processed ${inserted} private-path photo row(s).`);

  // Verification: count how many private photo URLs now have a provenance record.
  const verifyResult = await db.execute(sql`
    SELECT COUNT(*)::text AS count
    FROM photos p
    INNER JOIN object_uploads ou ON ou.object_path = p.url
    WHERE p.url NOT LIKE 'http%'
  `);
  const count = (verifyResult.rows[0] as { count: string } | undefined)?.count ?? "0";

  console.log(
    `Verification: ${count} out of ${privatePaths.length} private-path photo(s) now have an object_uploads record.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
