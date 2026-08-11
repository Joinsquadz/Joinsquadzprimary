import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Append-only ledger of PLAN SLOTS (events and trips alike). One row is written
// when a user creates a plan and when a user joins one (accepting an invite,
// RSVPing "going", or joining by invite code) — both are ways of taking part in
// a plan, and the free tier caps the combined total.
//
// Rows are NEVER deleted (deleting or leaving an event does not remove its
// ledger row), so the free-tier "plans in a rolling 12-month window" limit
// cannot be gamed by create-then-delete or join-then-leave. Slots age out
// naturally once a ledger row is older than 12 months.
//
// `source` distinguishes how the slot was taken ("create" | "join"), purely for
// UI copy and diagnostics; both consume one slot. The (user_id, event_id)
// unique index is what keeps a creator who also RSVPs from being charged twice.
export const eventCreationsTable = pgTable(
  "event_creations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    eventId: text("event_id"),
    source: text("source").notNull().default("create").$type<"create" | "join">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_creations_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("event_creations_user_event_unique").on(t.userId, t.eventId),
  ],
);

export type DbEventCreation = typeof eventCreationsTable.$inferSelect;
