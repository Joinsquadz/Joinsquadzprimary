import { pgTable, text, timestamp, integer, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const feedPostsTable = pgTable(
  "feed_posts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    authorId: text("author_id").notNull(),
    text: text("text").notNull().default(""),
    audience: text("audience").notNull(), // "friends" | squadId
    mediaUrl: text("media_url"),
    mediaType: text("media_type").$type<"photo" | "video">(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("IDX_feed_posts_author_id").on(table.authorId),
    index("IDX_feed_posts_audience").on(table.audience),
    index("IDX_feed_posts_created_at").on(table.createdAt),
  ],
);

export type FeedPost = typeof feedPostsTable.$inferSelect;

export const feedReactionsTable = pgTable(
  "feed_reactions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    postId: text("post_id")
      .notNull()
      .references(() => feedPostsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("feed_reactions_post_user_emoji_unique").on(table.postId, table.userId, table.emoji),
    index("IDX_feed_reactions_post_id").on(table.postId),
  ],
);

export type FeedReaction = typeof feedReactionsTable.$inferSelect;

export const feedCommentsTable = pgTable(
  "feed_comments",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    postId: text("post_id")
      .notNull()
      .references(() => feedPostsTable.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("IDX_feed_comments_post_id").on(table.postId)],
);

export type FeedComment = typeof feedCommentsTable.$inferSelect;
