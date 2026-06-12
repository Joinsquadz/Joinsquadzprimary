import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Append-only ledger of event creations. One row is written every time a user
// creates an event. Rows are NEVER deleted (deleting an event does not remove
// its ledger row), so the free-tier "events created in a rolling 12-month
// window" limit cannot be gamed by create-then-delete. Slots age out naturally
// once a ledger row is older than 12 months.
export const eventCreationsTable = pgTable(
  "event_creations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    eventId: text("event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("event_creations_user_created_idx").on(t.userId, t.createdAt)],
);

export type DbEventCreation = typeof eventCreationsTable.$inferSelect;
