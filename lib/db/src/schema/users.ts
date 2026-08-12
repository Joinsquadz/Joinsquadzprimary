import { pgTable, text, boolean, timestamp, varchar, jsonb, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  passwordHash: text("password_hash"),
  phone: text("phone"),
  emailVerified: boolean("email_verified").notNull().default(false),
  // Age gate (13+ minimum, COPPA). Data minimization: we deliberately do NOT
  // store the exact date of birth. The signup endpoint computes the age from
  // the submitted DOB, keeps only the derived pass/fail marker plus the birth
  // year (kept for future state-law age-tier compliance), and discards the
  // day/month. NULL means "predates the age gate" (legacy account), which is
  // distinct from `false` ("checked and under the minimum").
  meetsMinAge: boolean("meets_min_age"),
  birthYear: integer("birth_year"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // Unified Squadz+ entitlement flag. Source-of-truth is RevenueCat (mobile IAP);
  // this column is a webhook-maintained cache so server-side gating (squad/event
  // limits, vault) is a single fast DB read. The dormant Stripe webhook writes the
  // same field, so a future web purchase path can reactivate without schema churn.
  isSquadzPlus: boolean("is_squadz_plus").notNull().default(false),
  // Expiry of the subscription period that last drove `isSquadzPlus`, as epoch
  // millis. RevenueCat webhooks are unordered and retried, so this is what makes
  // the entitlement write monotonic: an event describing an OLDER period than
  // the one already applied is stale and must not overwrite a newer state.
  // Null = no period-bearing event applied yet (or a legacy/Stripe write).
  squadzPlusPeriodEndMs: text("squadz_plus_period_end_ms"),
  // Which Squadz+ tier the entitlement was bought at: 'founding' | 'standard'.
  // Null = unknown (legacy row, or an event that carried no product id). This is
  // display/provenance state only — `isSquadzPlus` alone decides ACCESS, so a
  // null tier can never gate a paying subscriber out of a feature. Deliberately
  // NOT cleared on revoke: the founding ledger is keyed by transaction and a
  // lapsed founding member is still historically a founding member. Endpoints
  // report `tier: 'none'` whenever `isSquadzPlus` is false, so a stale value
  // here is never surfaced as an active tier.
  squadzPlusTier: text("squadz_plus_tier"),
  calendarSyncEnabled: boolean("calendar_sync_enabled").notNull().default(false),
  calendarToken: text("calendar_token"),
  notifyEventInvites: boolean("notify_event_invites").notNull().default(true),
  notifyReminders: boolean("notify_reminders").notNull().default(true),
  notifyMessages: boolean("notify_messages").notNull().default(true),
  notifyFriendActivity: boolean("notify_friend_activity").notNull().default(true),
  notifySquadJoin: boolean("notify_squad_join").notNull().default(true),
  notifySquadLeave: boolean("notify_squad_leave").notNull().default(true),
  notifyPayments: boolean("notify_payments").notNull().default(true),
  privateProfile: boolean("private_profile").notNull().default(false),
  showRsvpActivity: boolean("show_rsvp_activity").notNull().default(true),
  venmoHandle: text("venmo_handle"),
  cashappHandle: text("cashapp_handle"),
  zelleHandle: text("zelle_handle"),
  bio: text("bio"),
  hometown: text("hometown"),
  pushToken: text("push_token"),
  friendCode: text("friend_code").unique(),
  activityLastReadAt: timestamp("activity_last_read_at", { withTimezone: true }),
  // BUG-02: profile auto-hide flag set when 3 distinct reporters flag this user.
  moderationHidden: boolean("moderation_hidden").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type UpsertUser = typeof usersTable.$inferInsert;

// Single-use tokens for email verification and password reset. Only a SHA-256
// hash of the token is stored; the raw token is sent in the emailed link.
export const authTokensTable = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "email_verify" | "password_reset"
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("IDX_auth_tokens_token_hash").on(table.tokenHash),
    index("IDX_auth_tokens_user_id").on(table.userId),
  ],
);

export type AuthToken = typeof authTokensTable.$inferSelect;

/**
 * BUG-01: server-side token revocation table.
 * When a user logs out, a SHA-256 hash of their bearer token is inserted here
 * (with an expiry matching the token's own exp). authMiddleware rejects any
 * Supabase JWT whose hash appears in this table, even if Supabase still considers
 * the token valid (within its ~1-hour TTL). Entries are pruned lazily on insert.
 */
export const revokedTokensTable = pgTable(
  "revoked_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("IDX_revoked_tokens_expires_at").on(table.expiresAt)],
);

export type RevokedToken = typeof revokedTokensTable.$inferSelect;

/**
 * BUG-04: persistent, shared rate-limit counters for authentication endpoints.
 * Replaces the in-process in-memory Map so limits survive restarts and work
 * correctly across multiple server instances.
 * Key format: "<bucket>:<ip>", e.g. "register:1.2.3.4".
 */
export const rateLimitsTable = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export type RateLimit = typeof rateLimitsTable.$inferSelect;
