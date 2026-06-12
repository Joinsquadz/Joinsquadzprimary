import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
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
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, uploadedAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
