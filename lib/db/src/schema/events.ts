import { pgTable, text, boolean, numeric, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A single ordered stop in a trip's itinerary. Trips reuse the shared `events`
 * row (no parallel schema); the itinerary lives in this JSON column. Locations
 * are freeform text only (no maps): `placeName` + `address`.
 */
export type ItineraryStop = {
  id: string;
  day: string; // ISO calendar date the stop belongs to, e.g. "2026-06-18"
  time: string; // freeform display start time, e.g. "9:00 AM" or ""
  endTime: string; // freeform display end time, e.g. "11:00 AM" or ""; renders a time range when set
  title: string;
  placeName: string; // freeform place label (no maps)
  address: string; // freeform address (no maps)
  note: string;
  category: "food" | "activity" | "lodging" | "travel" | "other";
  status: "confirmed" | "proposed";
  cost: number | null; // optional estimated cost, rolled up into the trip budget line
  paidById: string | null;
  assigneeId: string | null; // optional squad member responsible for this stop
  createdBy: string;
  votes: string[]; // userIds who upvoted a proposed stop
  sortOrder: number; // tiebreak ordering within a day when times are equal/blank
};

/** A shared packing-list item for a trip. */
export type PackingItem = {
  id: string;
  label: string;
  done: boolean;
  assigneeId: string | null;
  createdBy: string;
};

export const eventsTable = pgTable("events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  // Discriminates a one-off event from a multi-day trip. Both live in this same
  // table on the shared events object — a trip is just an event with a date
  // range + an ordered itinerary.
  type: text("type").notNull().default("event"), // "event" | "trip"
  emoji: text("emoji").notNull().default("🎉"),
  title: text("title").notNull(),
  date: text("date").notNull(),
  // Machine-readable event start (when a concrete time is chosen). The `date`
  // column above stays as a human-readable display string ("Sat, Jun 7 · 5 PM",
  // "TBD", …); this column is what we filter/expire on. NULL = no concrete time
  // yet (still being planned), so such events never auto-expire off the home feed.
  eventAt: timestamp("event_at", { withTimezone: true }),
  // Machine-readable trip date range. For trips, `startAt` mirrors `eventAt`
  // (so existing reminder/expiry logic still has a value) and `endAt` is the
  // last day of the trip — list visibility expires a trip on COALESCE(endAt,
  // eventAt). For plain events both are NULL (they expire on eventAt as before).
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  // Named gradient cover for a trip card/header (brand gradient family).
  coverStyle: text("cover_style").notNull().default(""),
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
  // Ordered itinerary stops (trips only; empty for plain events).
  itinerary: jsonb("itinerary").$type<ItineraryStop[]>().notNull().default(sql`'[]'::jsonb`),
  // Shared packing checklist (trips only; empty for plain events).
  packing: jsonb("packing").$type<PackingItem[]>().notNull().default(sql`'[]'::jsonb`),
  // Explicit per-person invite list. Grants access IN ADDITION to squad
  // membership (trips) / the rsvps map (events) — used so a friend who isn't in
  // the squad can be invited to a trip/event directly. Deliberately separate
  // from `rsvps`: it is only ever written by an explicit invite/uninvite action
  // (never by RSVP), so it is immune to the stale-RSVP trap that made
  // squad-trip access ignore the rsvps map. Removing a squad member still
  // revokes squad-only access; an explicit invitee is a separate intentional grant.
  invitedUserIds: jsonb("invited_user_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
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
