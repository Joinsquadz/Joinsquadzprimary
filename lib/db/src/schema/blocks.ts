import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userBlocksTable = pgTable(
  "user_blocks",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    blockerId: text("blocker_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("user_blocks_blocker_blocked_unique").on(table.blockerId, table.blockedId),
    index("IDX_user_blocks_blocker_id").on(table.blockerId),
    index("IDX_user_blocks_blocked_id").on(table.blockedId),
  ],
);

export type UserBlock = typeof userBlocksTable.$inferSelect;
