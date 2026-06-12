import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { photosTable } from "./photos";

/**
 * Personal favorites — a reference-only bookmark of a vault photo/video.
 *
 * Favoriting never copies or moves the underlying media; it just records that
 * `userId` bookmarked `photoId`. Favorites are private to the user, trigger no
 * notification, and link back to the original item in its squad context. The
 * unique (userId, photoId) pair makes favoriting idempotent.
 */
export const favoritesTable = pgTable(
  "favorites",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("favorites_user_photo_unique").on(t.userId, t.photoId)],
);

export const insertFavoriteSchema = createInsertSchema(favoritesTable).omit({ id: true, createdAt: true });
export type InsertFavorite = z.infer<typeof insertFavoriteSchema>;
export type Favorite = typeof favoritesTable.$inferSelect;
