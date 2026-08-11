import { pgTable, text, serial, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").references(() => eventsTable.id, { onDelete: "cascade" }),
  uploaderId: text("uploader_id").notNull(),
  url: text("url").notNull().unique(),
  squadId: text("squad_id"),
  sharedToSquad: boolean("shared_to_squad").notNull().default(false),
  mediaType: text("media_type").notNull().default("image"),
  caption: text("caption"),
  status: text("status").notNull().default("active").$type<"active" | "hidden">(),
  /**
   * Set on a PERSONAL COPY made by "Save to my vault": the id of the photo it
   * was copied from. Deliberately a plain integer with NO foreign key — the
   * whole point of a saved copy is that it outlives the source, so a cascade
   * (or even SET NULL) would defeat it. It exists only to make saving
   * idempotent ("have I already saved this one?") and to power the saved badge.
   */
  savedFromPhotoId: integer("saved_from_photo_id"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /**
   * UNIQUE, not just indexed: it is what makes "Save to my vault" idempotent
   * under concurrency. Two simultaneous saves both pass the "already saved?"
   * probe, so only a constraint can stop them inserting two copies (and
   * leaking the loser's storage object). Also the ON CONFLICT target the
   * insert relies on. Postgres allows many NULLs in a unique index, so
   * ordinary uploads (saved_from_photo_id IS NULL) are unaffected.
   */
  uniqueIndex("photos_uploader_saved_from_uq").on(t.uploaderId, t.savedFromPhotoId),
]);

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, uploadedAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
