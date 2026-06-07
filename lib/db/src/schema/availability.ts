import { pgTable, text, serial, jsonb, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "Find the Best Time" availability poll. Scoped to a squad and/or an event.
// The grid is days x slots; members tap the cells they're free.
//
// `days` holds the poll's columns. New polls store concrete calendar dates as
// ISO strings (e.g. "2026-06-14"), so squads coordinate on real dates rather
// than abstract weekdays. The server generates a sensible default range when a
// poll is created without explicit dates. Legacy polls may still contain plain
// weekday labels (e.g. "Mon"); both are handled gracefully by parsing cell keys
// on the LAST "-" so ISO dates (which contain dashes) round-trip correctly.
export const availabilityPollsTable = pgTable("availability_polls", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  squadId: text("squad_id"),
  eventId: text("event_id"),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull().default("Find the Best Time"),
  days: jsonb("days")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  slots: jsonb("slots")
    .$type<string[]>()
    .notNull()
    .default(sql`'["6PM","7PM","8PM","9PM","10PM"]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// One row per (poll, user). `cells` are the selected grid keys, e.g. "Mon-8PM".
export const availabilityResponsesTable = pgTable(
  "availability_responses",
  {
    id: serial("id").primaryKey(),
    pollId: text("poll_id")
      .notNull()
      .references(() => availabilityPollsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    cells: jsonb("cells").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    source: text("source").notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("availability_responses_poll_user_uniq").on(t.pollId, t.userId)],
);

export const insertAvailabilityPollSchema = createInsertSchema(availabilityPollsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAvailabilityPoll = z.infer<typeof insertAvailabilityPollSchema>;
export type AvailabilityPoll = typeof availabilityPollsTable.$inferSelect;
export type AvailabilityResponse = typeof availabilityResponsesTable.$inferSelect;
