import { pgTable, text, timestamp, integer, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const momentsTable = pgTable(
  "moments",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    authorId: text("author_id").notNull(),
    audience: text("audience").notNull(), // "friends" | squadId
    mediaUrl: text("media_url").notNull(),
    mediaType: text("media_type").notNull().$type<"photo" | "video">(),
    durationMs: integer("duration_ms"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("IDX_moments_author_id").on(table.authorId),
    index("IDX_moments_audience").on(table.audience),
    index("IDX_moments_expires_at").on(table.expiresAt),
  ],
);

export type Moment = typeof momentsTable.$inferSelect;

export const momentViewsTable = pgTable(
  "moment_views",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    momentId: text("moment_id")
      .notNull()
      .references(() => momentsTable.id, { onDelete: "cascade" }),
    viewerId: text("viewer_id").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("moment_views_moment_viewer_unique").on(table.momentId, table.viewerId),
    index("IDX_moment_views_moment_id").on(table.momentId),
  ],
);

export type MomentView = typeof momentViewsTable.$inferSelect;

export const momentReactionsTable = pgTable(
  "moment_reactions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    momentId: text("moment_id")
      .notNull()
      .references(() => momentsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("moment_reactions_moment_user_emoji_unique").on(
      table.momentId,
      table.userId,
      table.emoji,
    ),
    index("IDX_moment_reactions_moment_id").on(table.momentId),
  ],
);

export type MomentReaction = typeof momentReactionsTable.$inferSelect;
