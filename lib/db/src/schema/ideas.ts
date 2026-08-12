import { pgTable, text, integer, numeric, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { eventsTable } from "./events";

/** Categories a plan idea can be filed under. Events default to (and hide) `activity`. */
export const IDEA_CATEGORIES = ["activity", "food", "lodging", "transport", "other"] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

/**
 * Lifecycle statuses. `hidden` is reserved for the moderation auto-hide flow
 * (3 distinct reporters) — it is never reachable through the normal
 * pending/confirmed/archived transitions.
 */
export const IDEA_STATUSES = ["pending", "confirmed", "archived", "hidden"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/**
 * Plan Ideas — open-ended suggestions members submit for a plan (event or
 * trip) and upvote. Fully separate from availability polls AND from itinerary
 * stops: votes never auto-confirm anything; only an explicit organizer/co-admin
 * confirm moves an idea into the merged itinerary view. A confirmed idea stays
 * the SAME record (single-record rule — no copy into stops).
 *
 * `suggestedDate` is an ISO calendar day key ("2026-07-18") using the same
 * day-key convention as `ItineraryStop.day`, so confirmed ideas group into the
 * existing itinerary day sections. NULL = the "General" group. Trips only.
 *
 * `sortOrder` is only meaningful while `status = 'confirmed'`: position among
 * the CONFIRMED IDEAS of its day group (ideas order among themselves only —
 * stop ordering is a separate system and is never touched).
 *
 * `nudgeSentAt` backs the one-time vote-threshold organizer nudge: claimed
 * atomically (WHERE nudge_sent_at IS NULL) so it can never re-fire.
 */
export const planIdeasTable = pgTable(
  "plan_ideas",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    planId: text("plan_id")
      .notNull()
      .references(() => eventsTable.id, { onDelete: "cascade" }),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull().default("activity"),
    linkUrl: text("link_url"),
    estimatedCost: numeric("estimated_cost"),
    suggestedDate: text("suggested_date"),
    status: text("status").notNull().default("pending"),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    sortOrder: integer("sort_order"),
    nudgeSentAt: timestamp("nudge_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Query-aligned index for the ideas board: lists filter by plan, then by
  // status and date for the confirmed-group ordering. Declared here (not only
  // in schemaSync) so the migration snapshot knows about it — an index that
  // exists in live databases but not in the schema is drift.
  (t) => [index("plan_ideas_plan_status_date_idx").on(t.planId, t.status, t.suggestedDate)],
);

/**
 * One toggleable upvote per user per idea (unique pair). Deleting an idea
 * cascades its votes independently of the plan-level cascade.
 */
export const ideaVotesTable = pgTable(
  "idea_votes",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ideaId: text("idea_id")
      .notNull()
      .references(() => planIdeasTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idea_votes_idea_user_unique").on(t.ideaId, t.userId),
    // Vote counts filter by idea. Same reason as above: declared in the schema
    // so it appears in the snapshot, not only in schemaSync.
    index("idea_votes_idea_idx").on(t.ideaId),
  ],
);

export const insertPlanIdeaSchema = createInsertSchema(planIdeasTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPlanIdea = z.infer<typeof insertPlanIdeaSchema>;
export type PlanIdea = typeof planIdeasTable.$inferSelect;
export type IdeaVote = typeof ideaVotesTable.$inferSelect;
