import { pgTable, integer, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Single-row counter tracking how many Founding Member spots have actually been
// PAID FOR. The CHECK (id = 1) constraint guarantees there is only ever one row,
// so the counter can't be duplicated. The 500-spot cap lives in server code (a
// constant), NOT here — the table only stores the running total. The counter is
// incremented from the Stripe `checkout.session.completed` webhook (real
// payment), never at checkout-session creation, so abandoned checkouts can't
// burn a founding spot.
export const foundingMemberCounterTable = pgTable(
  "founding_member_counter",
  {
    id: integer("id").primaryKey().default(1),
    redeemed: integer("redeemed").notNull().default(0),
  },
  (t) => [check("founding_member_counter_single_row", sql`${t.id} = 1`)],
);

export type FoundingMemberCounter = typeof foundingMemberCounterTable.$inferSelect;

// Idempotency ledger: one row per Stripe subscription that has consumed a
// founding spot. Stripe can deliver `checkout.session.completed` more than once
// (retries / at-least-once delivery), so the subscription id is the primary key
// and the redemption is recorded with ON CONFLICT DO NOTHING — the counter is
// only incremented when a NEW ledger row is actually inserted. This makes the
// founding count exactly equal to the number of distinct paid founding
// subscriptions.
export const foundingMemberRedemptionsTable = pgTable("founding_member_redemptions", {
  subscriptionId: text("subscription_id").primaryKey(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FoundingMemberRedemption = typeof foundingMemberRedemptionsTable.$inferSelect;
