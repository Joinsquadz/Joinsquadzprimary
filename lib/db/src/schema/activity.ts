import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Materialized activity feed. Each row is one direct social interaction that a
 * specific recipient should see. We materialize (rather than derive on read)
 * because the source data lives in JSONB columns without per-entry timestamps
 * (events.rsvps, squads.member_ids), making accurate ordering/grouping
 * impossible to derive.
 *
 * Rows are written fire-and-forget from the interaction routes via
 * recordActivitySafe, and removed via removeActivity when the underlying
 * interaction is undone (un-react, un-heart, RSVP change).
 *
 * A row is never written when recipientId === actorId (you don't get activity
 * for your own actions).
 */
export type ActivityType =
  | "friend_request"
  | "friend_added"
  | "vibe_reaction"
  | "vibe_comment"
  | "vault_reaction"
  | "vault_comment"
  | "rsvp"
  | "squad_join"
  | "squad_invite"
  | "event_invite"
  // Plan ideas: one-time vote-threshold nudge to organizers, and a
  // "your idea made the plan" note to the submitter on confirm.
  | "idea_threshold"
  | "idea_confirmed";

export type ActivitySubjectType = "post" | "vault_photo" | "event" | "squad" | "user";

export type ActivityMeta = {
  /** vibe_comment / vault_comment: first 60 chars of the comment text. */
  commentPreview?: string;
  /** vibe_reaction / vault_reaction: the emoji reacted with. */
  emoji?: string;
  /** rsvp: the RSVP status. */
  rsvpStatus?: "going" | "maybe" | "notgoing";
  /** Display name of the subject (event name / squad name) for action text. */
  subjectName?: string;
  /** Emoji of the subject (event / squad) for action text. */
  subjectEmoji?: string;
  /** squad_join / squad_invite: the squad id to navigate to. */
  squadId?: string;
  /** event_invite: the event id to navigate to after accepting. */
  eventId?: string;
  /** vault_* : numeric photo id (vault uses serial ids) for navigation. */
  photoId?: number;
  /** Optional small thumbnail url for the content (vibe/vault media). */
  thumbUrl?: string;
  /** idea_threshold / idea_confirmed: the idea's title for action text. */
  ideaTitle?: string;
};

export const activityTable = pgTable(
  "activity",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    recipientId: text("recipient_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type").$type<ActivityType>().notNull(),
    subjectType: text("subject_type").$type<ActivitySubjectType>(),
    subjectId: text("subject_id"),
    meta: jsonb("meta").$type<ActivityMeta>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("IDX_activity_recipient_created").on(t.recipientId, t.createdAt),
    index("IDX_activity_recipient_actor_subject").on(
      t.recipientId,
      t.actorId,
      t.type,
      t.subjectId,
    ),
  ],
);

export type DbActivity = typeof activityTable.$inferSelect;
export type InsertActivity = typeof activityTable.$inferInsert;
