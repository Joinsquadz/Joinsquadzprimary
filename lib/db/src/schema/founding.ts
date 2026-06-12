import { pgTable, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Single-row counter tracking how many Founding Member checkout sessions have
// been claimed. The CHECK (id = 1) constraint guarantees there is only ever one
// row, so the counter can't be duplicated. The 500-spot cap lives in server code
// (a constant), NOT here — the table only stores the running total.
export const foundingMemberCounterTable = pgTable(
  "founding_member_counter",
  {
    id: integer("id").primaryKey().default(1),
    redeemed: integer("redeemed").notNull().default(0),
  },
  (t) => [check("founding_member_counter_single_row", sql`${t.id} = 1`)],
);

export type FoundingMemberCounter = typeof foundingMemberCounterTable.$inferSelect;
