import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Outstanding push deliveries owed to a specific device.
 *
 * Fire-once notifications (reminders, recaps, nudges) stamp a claim so only one
 * server sends them. When the push provider accepts some devices and rejects
 * others, releasing that claim would re-alert everyone, so the claim stays —
 * and the rejected devices would otherwise never be retried. A row here is the
 * durable record of "this token is still owed this exact payload", scoped by
 * `dedupeKey` to the notification that produced it.
 */
export const pushRetriesTable = pgTable(
  "push_retries",
  {
    id: text("id").primaryKey(),
    /** Identifies the originating notification, e.g. "event-reminder:evt-1". */
    dedupeKey: text("dedupe_key").notNull(),
    pushToken: text("push_token").notNull(),
    payload: jsonb("payload")
      .$type<{ title: string; body: string; data?: Record<string, unknown> }>()
      .notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_push_retries_next_attempt_at").on(table.nextAttemptAt),
    // One outstanding delivery per (notification, device). Re-enqueueing the
    // same failure must not stack duplicate alerts for one device.
    uniqueIndex("push_retries_key_token_uq").on(table.dedupeKey, table.pushToken),
  ],
);

export type PushRetry = typeof pushRetriesTable.$inferSelect;
