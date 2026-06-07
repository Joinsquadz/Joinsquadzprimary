import { pgTable, text, boolean, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventsTable = pgTable("events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  emoji: text("emoji").notNull().default("🎉"),
  title: text("title").notNull(),
  date: text("date").notNull(),
  location: text("location").notNull(),
  squadId: text("squad_id").notNull().default(""),
  squadName: text("squad_name").notNull().default("Personal"),
  hostId: text("host_id").notNull(),
  description: text("description").notNull().default(""),
  inviteCode: text("invite_code").notNull(),
  cancelled: boolean("cancelled").notNull().default(false),
  budget: numeric("budget"),
  rsvps: jsonb("rsvps").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  tasks: jsonb("tasks").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  costs: jsonb("costs").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  polls: jsonb("polls").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  messages: jsonb("messages").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({ createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type DbEvent = typeof eventsTable.$inferSelect;
