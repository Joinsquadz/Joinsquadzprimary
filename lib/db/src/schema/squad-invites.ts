import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const squadInvitesTable = pgTable(
  "squad_invites",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    squadId: text("squad_id").notNull(),
    inviterUserId: text("inviter_user_id").notNull(),
    invitedUserId: text("invited_user_id").notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "accepted" | "declined"
    squadName: text("squad_name").notNull().default(""),
    squadEmoji: text("squad_emoji").notNull().default("👥"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uniq_squad_invite_per_squad").on(t.squadId, t.invitedUserId)],
);

export type DbSquadInvite = typeof squadInvitesTable.$inferSelect;
