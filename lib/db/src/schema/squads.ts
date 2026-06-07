import { pgTable, text, jsonb, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const squadsTable = pgTable("squads", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  emoji: text("emoji").notNull().default("👥"),
  color: text("color").notNull().default("#FF5C3A"),
  memberIds: jsonb("member_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  isPublic: boolean("is_public").notNull().default(false),
  creatorId: text("creator_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

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
