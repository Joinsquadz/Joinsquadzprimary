import { pgTable, text, jsonb, boolean, timestamp, primaryKey, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const squadsTable = pgTable("squads", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  emoji: text("emoji").notNull().default("👥"),
  color: text("color").notNull().default("#FF5C3A"),
  memberIds: jsonb("member_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isPublic: boolean("is_public").notNull().default(false),
  creatorId: text("creator_id"),
  // User ids granted creator-level "manage" rights (edit settings, manage
  // members/invites). They cannot delete the squad or change co-admins.
  coAdminIds: jsonb("co_admin_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  membersCanInvite: boolean("members_can_invite").notNull().default(false),
  inviteCode: text("invite_code").unique(),
  // BUG-05: invite links expire 7 days after creation/regeneration.
  inviteCodeExpiresAt: timestamp("invite_code_expires_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// GIN index on memberIds is created by schemaSync.ts via raw SQL on every
// deploy. drizzle-orm v0.45.x doesn't support index().using("gin").on() here.

export const insertSquadSchema = createInsertSchema(squadsTable).omit({ createdAt: true });
export type InsertSquad = z.infer<typeof insertSquadSchema>;
export type DbSquad = typeof squadsTable.$inferSelect;

/**
 * Per-squad notification mutes. A row here means the user has muted
 * squad-join push notifications for that specific squad. No row = not muted.
 */
export const squadMutesTable = pgTable(
  "squad_mutes",
  {
    userId: text("user_id").notNull(),
    squadId: text("squad_id").notNull(),
    mutedAt: timestamp("muted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.squadId] })],
);

export type DbSquadMute = typeof squadMutesTable.$inferSelect;

/**
 * Append-only membership history for DM eligibility (W-01). One row per
 * (squad, user) pair written at the moment a user first joins the squad.
 * Rows are NEVER deleted — a user who leaves and rejoins does not get a new
 * row (ON CONFLICT DO NOTHING). This allows the DM gate to verify two users
 * have ever shared a squad without querying live memberIds.
 */
export const squadMemberHistoryTable = pgTable(
  "squad_member_history",
  {
    squadId: text("squad_id").notNull(),
    userId: text("user_id").notNull(),
    firstJoinedAt: timestamp("first_joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.squadId, t.userId] }),
    index("squad_member_history_user_idx").on(t.userId),
  ],
);

export type DbSquadMemberHistory = typeof squadMemberHistoryTable.$inferSelect;
