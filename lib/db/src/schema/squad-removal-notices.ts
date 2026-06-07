import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const squadRemovalNoticesTable = pgTable("squad_removal_notices", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(),
  squadName: text("squad_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  seenAt: timestamp("seen_at", { withTimezone: true }),
});

export type DbSquadRemovalNotice = typeof squadRemovalNoticesTable.$inferSelect;
