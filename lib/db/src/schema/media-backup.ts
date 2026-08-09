import { check, integer, jsonb, pgTable, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// One durable status row for the dead-man's switch. A partial backup must not
// move lastSuccessAt forward; only the API's clean backup completion writes it.
export const mediaBackupStatusTable = pgTable(
  "media_backup_status",
  {
    id: integer("id").primaryKey().default(1),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastSummary: jsonb("last_summary"),
  },
  (t) => [check("media_backup_status_single_row", sql`${t.id} = 1`)],
);

export type MediaBackupStatusRecord = typeof mediaBackupStatusTable.$inferSelect;