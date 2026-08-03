import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const reportsTable = pgTable(
  "reports",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    reporterId: text("reporter_id").notNull(),
    contentType: text("content_type")
      .notNull()
      .$type<"post" | "moment" | "message" | "photo" | "profile" | "idea">(),
    contentId: text("content_id").notNull(),
    targetUserId: text("target_user_id").notNull(),
    reason: text("reason")
      .notNull()
      .$type<"spam" | "inappropriate_content" | "harassment" | "other">(),
    notes: text("notes"),
    status: text("status").notNull().default("pending").$type<"pending" | "reviewed" | "dismissed">(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("IDX_reports_reporter_id").on(table.reporterId),
    index("IDX_reports_target_user_id").on(table.targetUserId),
    index("IDX_reports_content").on(table.contentType, table.contentId),
    index("IDX_reports_created_at").on(table.createdAt),
    index("IDX_reports_status").on(table.status),
    unique("reports_reporter_content_unique").on(
      table.reporterId,
      table.contentType,
      table.contentId,
    ),
  ],
);

export type Report = typeof reportsTable.$inferSelect;
