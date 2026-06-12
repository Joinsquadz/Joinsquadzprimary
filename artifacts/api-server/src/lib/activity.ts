import { and, eq } from "drizzle-orm";
import {
  db,
  activityTable,
  type ActivityType,
  type ActivitySubjectType,
  type ActivityMeta,
} from "@workspace/db";
import { logger } from "./logger";
import { emitActivityUpdate } from "./activityEvents";

export type RecordActivityInput = {
  recipientId: string;
  actorId: string;
  type: ActivityType;
  subjectType?: ActivitySubjectType;
  subjectId?: string;
  meta?: ActivityMeta;
  /**
   * For idempotent/grouped interactions (a reaction, heart, or RSVP), set true
   * so any prior row for the same (recipient, actor, type, subject) is removed
   * before inserting. This keeps exactly one row per actor+subject — a re-action
   * or RSVP change refreshes the timestamp instead of piling up duplicate rows
   * (which would otherwise inflate the unread count).
   */
  dedupe?: boolean;
};

/**
 * Insert one activity row for `recipientId`, then nudge their SSE stream so the
 * badge / feed updates live. Never throws (fire-and-forget). Skips entirely when
 * the recipient is the actor (you don't get activity for your own actions).
 */
export function recordActivitySafe(input: RecordActivityInput): void {
  if (!input.recipientId || !input.actorId) return;
  if (input.recipientId === input.actorId) return;
  void (async () => {
    try {
      if (input.dedupe && input.subjectId) {
        await db
          .delete(activityTable)
          .where(
            and(
              eq(activityTable.recipientId, input.recipientId),
              eq(activityTable.actorId, input.actorId),
              eq(activityTable.type, input.type),
              eq(activityTable.subjectId, input.subjectId),
            ),
          );
      }
      await db.insert(activityTable).values({
        recipientId: input.recipientId,
        actorId: input.actorId,
        type: input.type,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        meta: input.meta ?? null,
      });
      emitActivityUpdate(input.recipientId);
    } catch (err) {
      logger.error({ err, type: input.type }, "Failed to record activity");
    }
  })();
}

/**
 * Remove the activity row(s) for a now-undone interaction (un-react, un-heart,
 * or an RSVP that is being replaced). Matches recipient + actor + type +
 * subjectId so it only clears the relevant entry. Never throws.
 */
export function removeActivity(input: {
  recipientId: string;
  actorId: string;
  type: ActivityType;
  subjectId: string;
}): void {
  if (!input.recipientId || !input.actorId) return;
  if (input.recipientId === input.actorId) return;
  void (async () => {
    try {
      await db
        .delete(activityTable)
        .where(
          and(
            eq(activityTable.recipientId, input.recipientId),
            eq(activityTable.actorId, input.actorId),
            eq(activityTable.type, input.type),
            eq(activityTable.subjectId, input.subjectId),
          ),
        );
      emitActivityUpdate(input.recipientId);
    } catch (err) {
      logger.error({ err, type: input.type }, "Failed to remove activity");
    }
  })();
}
