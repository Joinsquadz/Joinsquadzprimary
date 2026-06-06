import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  uploaderId: text("uploader_id").notNull(),
  url: text("url").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, uploadedAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
