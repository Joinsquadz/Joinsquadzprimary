import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Friendships are stored symmetrically: adding a friend writes BOTH
 * (ownerId -> friendId) and (friendId -> ownerId) rows, so each user sees the
 * other in their own list. Removing deletes both directions. The unique
 * constraint makes inserts idempotent via onConflictDoNothing.
 */
export const friendshipsTable = pgTable(
  "friendships",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerId: text("owner_id").notNull(),
    friendId: text("friend_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [unique("friendships_owner_friend_unique").on(table.ownerId, table.friendId)],
);

export type DbFriendship = typeof friendshipsTable.$inferSelect;
