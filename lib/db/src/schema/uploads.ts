import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Records who requested each upload URL, binding an object path to its owner at
 * upload time. Other features (e.g. the feed) verify a referenced media path is
 * owned by the user claiming it, so a user cannot point a post at someone else's
 * private object and self-authorize via the storage ACL. The object path is the
 * primary key (server-generated, unguessable) so the first writer — always the
 * uploader the URL was issued to — owns it.
 */
export const objectUploadsTable = pgTable("object_uploads", {
  objectPath: text("object_path").primaryKey(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ObjectUpload = typeof objectUploadsTable.$inferSelect;
