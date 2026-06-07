import { pgTable, text, boolean, timestamp, varchar, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  calendarSyncEnabled: boolean("calendar_sync_enabled").notNull().default(false),
  calendarToken: text("calendar_token"),
  notifyEventInvites: boolean("notify_event_invites").notNull().default(true),
  notifyReminders: boolean("notify_reminders").notNull().default(true),
  notifyMessages: boolean("notify_messages").notNull().default(true),
  notifyFriendActivity: boolean("notify_friend_activity").notNull().default(true),
  privateProfile: boolean("private_profile").notNull().default(false),
  showRsvpActivity: boolean("show_rsvp_activity").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;
