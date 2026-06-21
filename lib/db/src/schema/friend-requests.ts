import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Pending friend requests. A request moves from `pending` → `accepted` (which
 * writes the symmetric friendships rows) or `pending` → `declined`. The unique
 * constraint prevents duplicate requests between the same pair of users.
 */
export const friendRequestsTable = pgTable(
  "friend_requests",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    status: text("status")
      .$type<"pending" | "accepted" | "declined">()
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("friend_requests_from_to_unique").on(table.fromUserId, table.toUserId),
  ],
);

export type DbFriendRequest = typeof friendRequestsTable.$inferSelect;
