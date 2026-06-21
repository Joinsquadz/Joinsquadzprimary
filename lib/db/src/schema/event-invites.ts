import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const eventInvitesTable = pgTable(
  "event_invites",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    eventId: text("event_id").notNull(),
    inviterUserId: text("inviter_user_id").notNull(),
    invitedUserId: text("invited_user_id").notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "accepted" | "declined"
    eventTitle: text("event_title").notNull().default(""),
    eventEmoji: text("event_emoji").notNull().default("🗓️"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uniq_event_invite_per_event").on(t.eventId, t.invitedUserId)],
);

export type DbEventInvite = typeof eventInvitesTable.$inferSelect;
