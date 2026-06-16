import { pgTable, text, boolean, numeric, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eventsTable = pgTable("events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  emoji: text("emoji").notNull().default("🎉"),
  title: text("title").notNull(),
  date: text("date").notNull(),
  // Machine-readable event start (when a concrete time is chosen). The `date`
  // column above stays as a human-readable display string ("Sat, Jun 7 · 5 PM",
  // "TBD", …); this column is what we filter/expire on. NULL = no concrete time
  // yet (still being planned), so such events never auto-expire off the home feed.
  eventAt: timestamp("event_at", { withTimezone: true }),
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
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  // Fire-once marker for the "day-of" heads-up reminder (sent the morning of /
  // hours-ahead of the event, distinct from the 2h "starting soon" reminder).
  dayOfReminderSentAt: timestamp("day_of_reminder_sent_at", { withTimezone: true }),
  // Fire-once marker for the post-event "drop your photos" recap prompt.
  recapPromptSentAt: timestamp("recap_prompt_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  version: integer("version").notNull().default(1),
});

export const insertEventSchema = createInsertSchema(eventsTable).omit({ createdAt: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type DbEvent = typeof eventsTable.$inferSelect;
