/**
 * One-way backfill: embedded `events.messages` JSON → conversation threads.
 *
 * Plan (event & trip) chat used to be an array on the event row. It now lives in
 * a real conversation thread (`conversations.type = "event"`, unique on
 * `event_id`) so it can paginate, track server-side reads, stream, and stop
 * bumping the shared event version on every send.
 *
 * Runs at every boot and is safe to run repeatedly:
 *  - a transaction-scoped advisory lock serialises concurrent instances;
 *  - each legacy message is inserted under a DETERMINISTIC id
 *    (`legacy:<eventId>:<legacyMessageId>`) with ON CONFLICT DO NOTHING, so a
 *    partially-applied run can never duplicate a message;
 *  - each event's JSON array is drained in the SAME transaction as its inserts,
 *    so a later run finds nothing left to do (and a crash mid-run leaves the
 *    event fully migrated or fully untouched, never half).
 *
 * Sender, original timestamp and ordering are preserved. Legacy messages carry
 * no attachments, so every migrated row gets an empty attachment list.
 *
 * Read state: plan-chat reads used to be tracked client-side only, so there is
 * no server-side "who had seen what" to carry over. Migrated participants are
 * stamped as caught up at migration time — otherwise every historical message
 * would resurface as an unread badge the moment the new build ships.
 */

import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { logger } from './logger';

/** Arbitrary but stable key so only one instance runs the backfill at a time. */
const ADVISORY_LOCK_KEY = 728_411_903;

type LegacyMessage = {
  id?: unknown;
  senderId?: unknown;
  text?: unknown;
  time?: unknown;
  createdAt?: unknown;
};

type LegacyEventRow = {
  id: string;
  host_id: string;
  squad_id: string | null;
  type: string;
  rsvps: Record<string, string> | null;
  invited_user_ids: string[] | null;
  messages: LegacyMessage[] | null;
  created_at: Date | string | null;
};

/**
 * Resolve the timestamp for a legacy message. Older messages only carried the
 * display string ("Just now"), so fall back to the event's creation time and
 * nudge by the message's index — that keeps the original ORDER stable even when
 * the individual timestamps were never recorded.
 */
function resolveCreatedAt(m: LegacyMessage, index: number, eventCreatedAt: Date): Date {
  if (typeof m.createdAt === 'string') {
    const d = new Date(m.createdAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(eventCreatedAt.getTime() + index * 1000);
}

export async function migrateEmbeddedEventMessages(): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // Transaction-scoped: released at COMMIT, so it is safe under Supabase's
      // Transaction pooler (see the pooler notes in lib/db connection).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

      const { rows } = await tx.execute<LegacyEventRow>(sql`
        SELECT id, host_id, squad_id, type, rsvps, invited_user_ids, messages, created_at
        FROM events
        WHERE jsonb_array_length(COALESCE(messages, '[]'::jsonb)) > 0
      `);
      if (rows.length === 0) return;

      let migratedMessages = 0;

      for (const ev of rows) {
        const legacy = (ev.messages ?? []).filter(
          (m): m is LegacyMessage => !!m && typeof m === 'object',
        );
        if (legacy.length === 0) {
          await tx.execute(sql`UPDATE events SET messages = '[]'::jsonb WHERE id = ${ev.id}`);
          continue;
        }

        // --- Get-or-create the thread (unique on event_id, so this converges
        //     even if a live request created it first).
        const { rows: created } = await tx.execute<{ id: string }>(sql`
          INSERT INTO conversations ("type", "event_id", "created_by")
          VALUES ('event', ${ev.id}, ${ev.host_id})
          ON CONFLICT ("event_id") DO NOTHING
          RETURNING id
        `);
        let conversationId = created[0]?.id;
        if (!conversationId) {
          const { rows: found } = await tx.execute<{ id: string }>(
            sql`SELECT id FROM conversations WHERE event_id = ${ev.id}`,
          );
          conversationId = found[0]?.id;
        }
        if (!conversationId) {
          logger.error({ eventId: ev.id }, '[eventChatMigration] Could not resolve thread; skipping');
          continue;
        }

        // --- Messages, in their original order, under deterministic ids.
        const eventCreatedAt = ev.created_at ? new Date(ev.created_at) : new Date();
        let newest: Date | null = null;
        let newestText = '';
        let newestSender = '';
        for (let i = 0; i < legacy.length; i++) {
          const m = legacy[i];
          const senderId = typeof m.senderId === 'string' ? m.senderId : '';
          if (!senderId) continue;
          const text = typeof m.text === 'string' ? m.text : '';
          const legacyId = typeof m.id === 'string' ? m.id : `idx${i}`;
          const createdAt = resolveCreatedAt(m, i, eventCreatedAt);
          await tx.execute(sql`
            INSERT INTO conversation_messages
              ("id", "conversation_id", "sender_id", "text", "attachments", "status", "created_at")
            VALUES (
              ${`legacy:${ev.id}:${legacyId}`},
              ${conversationId},
              ${senderId},
              ${text},
              '[]'::jsonb,
              'visible',
              ${createdAt.toISOString()}
            )
            ON CONFLICT ("id") DO NOTHING
          `);
          migratedMessages++;
          if (!newest || createdAt >= newest) {
            newest = createdAt;
            newestText = text;
            newestSender = senderId;
          }
        }

        // --- Participants: everyone who can currently see the plan. Stamped as
        //     already read (see the read-state note in the file header).
        const audience = new Set<string>([ev.host_id]);
        for (const uid of ev.invited_user_ids ?? []) audience.add(uid);
        if (ev.type !== 'trip') {
          for (const uid of Object.keys(ev.rsvps ?? {})) audience.add(uid);
        }
        if (ev.squad_id) {
          const { rows: squads } = await tx.execute<{ member_ids: string[] | null }>(
            sql`SELECT member_ids FROM squads WHERE id = ${ev.squad_id}`,
          );
          for (const uid of squads[0]?.member_ids ?? []) audience.add(uid);
        }
        // GREATEST(now(), newest): `now()` is the TRANSACTION start time, which
        // can predate a migrated message's timestamp (legacy rows without a
        // recorded timestamp are anchored to the event's creation time and
        // nudged forward to keep their order). Without the GREATEST, those
        // messages land "after" the read stamp and arrive as phantom unreads.
        const readStamp = newest ? newest.toISOString() : null;
        for (const uid of audience) {
          await tx.execute(sql`
            INSERT INTO conversation_participants ("conversation_id", "user_id", "last_read_at")
            VALUES (
              ${conversationId},
              ${uid},
              ${readStamp === null ? sql`now()` : sql`GREATEST(now(), ${readStamp}::timestamptz)`}
            )
            ON CONFLICT ("conversation_id", "user_id") DO NOTHING
          `);
        }

        // --- Denormalized preview. Only seed it when the thread has never had a
        //     (newer) real message, so a live send that beat the backfill wins.
        if (newest) {
          await tx.execute(sql`
            UPDATE conversations
            SET last_message_at = ${newest.toISOString()},
                last_message_preview = ${newestText.slice(0, 140)},
                last_message_sender_id = ${newestSender}
            WHERE id = ${conversationId}
              AND (last_message_sender_id = '' OR last_message_at < ${newest.toISOString()})
          `);
        }

        // --- Drain the legacy column in the SAME transaction. Deliberately does
        //     NOT bump events.version: chat is no longer part of the event
        //     record, so this must not invalidate any client's optimistic write.
        await tx.execute(sql`UPDATE events SET messages = '[]'::jsonb WHERE id = ${ev.id}`);
      }

      logger.info(
        { events: rows.length, messages: migratedMessages },
        '[eventChatMigration] Migrated embedded plan chat into conversation threads',
      );
    });
  } catch (err) {
    // Never block boot: the app works without the backfill (those old messages
    // just stay invisible until the next successful run).
    logger.error({ err }, '[eventChatMigration] Backfill FAILED — legacy plan chat not migrated');
  }
}
