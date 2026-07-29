import { pgTable, text, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A message attachment captured in-app or attached from the library. The bytes
 * live in object storage; `url` is the normalized object path served through the
 * authenticated ACL proxy (same flow as photos). `kind` distinguishes how the
 * client should render it.
 */
export type MessageAttachment = {
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
};

/**
 * A conversation thread. Two flavours:
 *  - "direct": a 1:1 DM. `directKey` is the sorted "a|b" pair of user ids and is
 *    unique, so get-or-create is idempotent regardless of who initiates.
 *  - "squad": a group chat bound to a squad. `squadId` is set and unique, so each
 *    squad has exactly one chat thread.
 * `lastMessageAt`/`lastMessagePreview`/`lastMessageSenderId` are denormalized so
 * the conversation list can order + preview without a per-row message lookup.
 */
export const conversationsTable = pgTable(
  "conversations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    type: text("type").notNull(),
    squadId: text("squad_id"),
    directKey: text("direct_key"),
    createdBy: text("created_by").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text("last_message_preview").notNull().default(""),
    lastMessageSenderId: text("last_message_sender_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversations_direct_key_unique").on(t.directKey),
    uniqueIndex("conversations_squad_id_unique").on(t.squadId),
  ],
);

/**
 * Membership of a conversation, one row per participant. `lastReadAt` powers
 * unread badges and "Seen"/"Seen by N" read receipts. For squad chats the rows
 * are synced from the squad's current member list on access.
 */
export const conversationParticipantsTable = pgTable(
  "conversation_participants",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("conversation_participants_convo_user_unique").on(t.conversationId, t.userId),
    index("conversation_participants_user_idx").on(t.userId),
  ],
);

/**
 * A single message in a conversation. `text` may be empty when the message is a
 * pure attachment post. `attachments` holds 0+ media references.
 */
export const conversationMessagesTable = pgTable(
  "conversation_messages",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    senderId: text("sender_id").notNull(),
    text: text("text").notNull().default(""),
    attachments: jsonb("attachments").$type<MessageAttachment[]>().notNull().default(sql`'[]'::jsonb`),
    // BUG-02: moderation status. 'visible' (default) | 'hidden' (auto-hidden by
    // 3-distinct-reporter threshold). Hidden messages are filtered from all reads.
    status: text("status").notNull().default("visible").$type<"visible" | "hidden">(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_messages_convo_idx").on(t.conversationId, t.createdAt)],
);

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  lastMessageAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type DbConversation = typeof conversationsTable.$inferSelect;

export const insertConversationParticipantSchema = createInsertSchema(
  conversationParticipantsTable,
).omit({ id: true, createdAt: true });
export type InsertConversationParticipant = z.infer<typeof insertConversationParticipantSchema>;
export type DbConversationParticipant = typeof conversationParticipantsTable.$inferSelect;

export const insertConversationMessageSchema = createInsertSchema(conversationMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;
export type DbConversationMessage = typeof conversationMessagesTable.$inferSelect;
