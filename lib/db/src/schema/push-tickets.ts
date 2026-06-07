import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

export const pushTicketsTable = pgTable(
  "push_tickets",
  {
    ticketId: text("ticket_id").primaryKey(),
    pushToken: text("push_token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("idx_push_tickets_created_at").on(table.createdAt)],
);

export type PushTicket = typeof pushTicketsTable.$inferSelect;
