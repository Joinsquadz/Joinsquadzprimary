import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const squadsTable = pgTable("squads", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("👥"),
  color: text("color").notNull().default("#FF5C3A"),
  memberIds: jsonb("member_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertSquadSchema = createInsertSchema(squadsTable).omit({ createdAt: true });
export type InsertSquad = z.infer<typeof insertSquadSchema>;
export type DbSquad = typeof squadsTable.$inferSelect;
