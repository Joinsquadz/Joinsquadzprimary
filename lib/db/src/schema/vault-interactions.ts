import { pgTable, text, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { photosTable } from "./photos";

/**
 * Hearts (likes) on a vault photo/video. One heart per (photoId, userId), so the
 * toggle is idempotent. Hearts cascade-delete with their photo. Anyone who can
 * view the media (squad members / personal owner) may heart it.
 */
export const vaultHeartsTable = pgTable(
  "vault_hearts",
  {
    id: serial("id").primaryKey(),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vault_hearts_photo_user_unique").on(t.photoId, t.userId)],
);

export const insertVaultHeartSchema = createInsertSchema(vaultHeartsTable).omit({ id: true, createdAt: true });
export type InsertVaultHeart = z.infer<typeof insertVaultHeartSchema>;
export type VaultHeart = typeof vaultHeartsTable.$inferSelect;

/**
 * Comments on a vault photo/video. Comments are soft-deleted (deletedAt) so the
 * author or the photo's uploader can remove a comment without breaking threads.
 * Comments cascade-delete with their photo.
 */
export const vaultCommentsTable = pgTable(
  "vault_comments",
  {
    id: serial("id").primaryKey(),
    photoId: integer("photo_id")
      .notNull()
      .references(() => photosTable.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("vault_comments_photo_idx").on(t.photoId)],
);

export const insertVaultCommentSchema = createInsertSchema(vaultCommentsTable).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});
export type InsertVaultComment = z.infer<typeof insertVaultCommentSchema>;
export type VaultComment = typeof vaultCommentsTable.$inferSelect;
