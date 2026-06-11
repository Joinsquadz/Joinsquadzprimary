import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  friendshipsTable,
  squadsTable,
  squadMutesTable,
  squadRemovalNoticesTable,
  eventsTable,
  photosTable,
  availabilityPollsTable,
  availabilityResponsesTable,
  availabilityNudgesTable,
  conversationsTable,
  conversationParticipantsTable,
  conversationMessagesTable,
  feedPostsTable,
  feedReactionsTable,
  feedCommentsTable,
  momentsTable,
  momentViewsTable,
  momentReactionsTable,
  objectUploadsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { getUncachableStripeClient } from "../stripeClient";

const router: IRouter = Router();

/**
 * Permanently delete the authenticated user's account and ALL of their data.
 *
 * This is irreversible. The flow:
 *  1. Best-effort cancel any active Stripe subscription (external call, before the
 *     DB transaction so a Stripe outage logs an error but never strands the user
 *     in an undeletable state — the row is still purged and ops can reconcile).
 *  2. In a single transaction, purge every table that references the user:
 *     - Squads: apply the same leave/transfer ("B1") rule used by the squad-leave
 *       route. A squad where the user is the sole member is deleted entirely
 *       (along with its chat, polls and mutes); a squad they created but others
 *       remain in transfers ownership to the next longest-standing member (the
 *       first id remaining in member_ids, which is kept in join order).
 *     - Direct (1:1) conversations the user is in are deleted entirely (cascades
 *       the other participant + messages); their participant rows and authored
 *       messages are removed from squad chats.
 *     - Photos, hosted events (cascades their photos), availability polls/
 *       responses/nudges, feed posts/reactions/comments, moments/views/reactions,
 *       friendships (both directions), squad-removal notices, object-upload
 *       ownership records, and finally the user row (cascades auth_tokens).
 *     - Sessions referencing the user are best-effort cleared.
 */
router.delete("/account", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) {
      res.status(404).json({ error: "Account not found." });
      return;
    }

    // 1. Best-effort cancel the Stripe subscription (external; outside the tx).
    if (user.stripeSubscriptionId) {
      try {
        const stripe = await getUncachableStripeClient();
        await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      } catch (err) {
        logger.error(
          { err, userId },
          "Failed to cancel Stripe subscription during account deletion; continuing with data purge",
        );
      }
    }

    // 2. Purge all DB data in one transaction so a failure rolls back cleanly.
    await db.transaction(async (tx) => {
      // --- Squads: leave / transfer / delete (mirrors the squad-leave "B1" rule).
      const squads = await tx
        .select()
        .from(squadsTable)
        .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);
      for (const squad of squads) {
        const memberIds = (squad.memberIds ?? []) as string[];
        const updated = memberIds.filter((m) => m !== userId);
        if (updated.length === 0) {
          // Sole member → delete the squad and everything bound to it.
          await tx.delete(squadsTable).where(eq(squadsTable.id, squad.id));
          await tx.delete(squadMutesTable).where(eq(squadMutesTable.squadId, squad.id));
          // Deleting the conversation cascades its participants + messages.
          await tx.delete(conversationsTable).where(eq(conversationsTable.squadId, squad.id));
          // Deleting polls cascades their responses + nudges.
          await tx.delete(availabilityPollsTable).where(eq(availabilityPollsTable.squadId, squad.id));
        } else {
          // Others remain → drop the user, transferring ownership if they created it.
          // member_ids is kept in join order, so updated[0] is the longest-standing member.
          const effectiveCreatorId = squad.creatorId ?? memberIds[0] ?? null;
          const nextCreatorId =
            effectiveCreatorId !== null && userId === effectiveCreatorId ? updated[0] : squad.creatorId;
          await tx
            .update(squadsTable)
            .set({ memberIds: updated, creatorId: nextCreatorId })
            .where(eq(squadsTable.id, squad.id));
          await tx
            .delete(squadMutesTable)
            .where(and(eq(squadMutesTable.userId, userId), eq(squadMutesTable.squadId, squad.id)));
        }
      }

      // --- Conversations: delete 1:1 DMs entirely, scrub from squad chats.
      const directConvos = await tx
        .select({ id: conversationParticipantsTable.conversationId })
        .from(conversationParticipantsTable)
        .innerJoin(
          conversationsTable,
          eq(conversationsTable.id, conversationParticipantsTable.conversationId),
        )
        .where(
          and(
            eq(conversationParticipantsTable.userId, userId),
            eq(conversationsTable.type, "direct"),
          ),
        );
      const directIds = directConvos.map((c) => c.id);
      if (directIds.length > 0) {
        // Cascades participants + messages of those DMs.
        await tx.delete(conversationsTable).where(inArray(conversationsTable.id, directIds));
      }
      await tx
        .delete(conversationParticipantsTable)
        .where(eq(conversationParticipantsTable.userId, userId));
      await tx
        .delete(conversationMessagesTable)
        .where(eq(conversationMessagesTable.senderId, userId));

      // Surviving (squad) conversations may have a denormalized "last message"
      // pointing at a message we just deleted — recompute from the newest
      // remaining message so no deleted-user preview/id lingers.
      const staleConvos = await tx
        .select({ id: conversationsTable.id })
        .from(conversationsTable)
        .where(eq(conversationsTable.lastMessageSenderId, userId));
      for (const convo of staleConvos) {
        const [latest] = await tx
          .select()
          .from(conversationMessagesTable)
          .where(eq(conversationMessagesTable.conversationId, convo.id))
          .orderBy(desc(conversationMessagesTable.createdAt))
          .limit(1);
        if (latest) {
          await tx
            .update(conversationsTable)
            .set({
              lastMessageAt: latest.createdAt,
              lastMessagePreview: latest.text,
              lastMessageSenderId: latest.senderId,
            })
            .where(eq(conversationsTable.id, convo.id));
        } else {
          await tx
            .update(conversationsTable)
            .set({ lastMessagePreview: "", lastMessageSenderId: "", lastMessageAt: new Date() })
            .where(eq(conversationsTable.id, convo.id));
        }
      }

      // --- Photos + hosted events (event delete cascades its photos).
      await tx.delete(photosTable).where(eq(photosTable.uploaderId, userId));
      await tx.delete(eventsTable).where(eq(eventsTable.hostId, userId));

      // --- Scrub the user out of events they DON'T host (their RSVP, chat
      // messages, task assignments, poll votes, and cost entries). Costs the
      // user paid or owed a share in are removed; other members' shares stay
      // intact so remaining splits are unaffected. Version is bumped to respect
      // optimistic-concurrency checks on these JSON columns.
      const referencingEvents = await tx
        .select()
        .from(eventsTable)
        .where(
          sql`${eventsTable.hostId} <> ${userId} AND (
            ${eventsTable.rsvps} ? ${userId}
            OR ${eventsTable.costs}::text LIKE ${"%" + userId + "%"}
            OR ${eventsTable.tasks}::text LIKE ${"%" + userId + "%"}
            OR ${eventsTable.polls}::text LIKE ${"%" + userId + "%"}
            OR ${eventsTable.messages}::text LIKE ${"%" + userId + "%"}
          )`,
        );
      for (const ev of referencingEvents) {
        const rsvps = { ...((ev.rsvps ?? {}) as Record<string, string>) };
        delete rsvps[userId];
        const messages = ((ev.messages ?? []) as Array<{ senderId?: string }>).filter(
          (m) => m.senderId !== userId,
        );
        const tasks = ((ev.tasks ?? []) as Array<{ assigneeId?: string | null }>).map((t) =>
          t.assigneeId === userId ? { ...t, assigneeId: null } : t,
        );
        const costs = ((ev.costs ?? []) as Array<{ paidById?: string; shares?: Array<{ userId: string }> }>)
          .filter((c) => c.paidById !== userId)
          .map((c) => ({ ...c, shares: (c.shares ?? []).filter((s) => s.userId !== userId) }));
        const polls = ((ev.polls ?? []) as Array<{ options?: Array<{ voterIds?: string[] }> }>).map((p) => ({
          ...p,
          options: (p.options ?? []).map((o) => ({
            ...o,
            voterIds: (o.voterIds ?? []).filter((v) => v !== userId),
          })),
        }));
        await tx
          .update(eventsTable)
          .set({ rsvps, messages, tasks, costs, polls, version: (ev.version ?? 1) + 1 })
          .where(eq(eventsTable.id, ev.id));
      }

      // --- Availability: own polls (cascade) + responses/nudges left elsewhere.
      await tx.delete(availabilityPollsTable).where(eq(availabilityPollsTable.createdBy, userId));
      await tx.delete(availabilityResponsesTable).where(eq(availabilityResponsesTable.userId, userId));
      await tx
        .delete(availabilityNudgesTable)
        .where(
          or(
            eq(availabilityNudgesTable.fromUserId, userId),
            eq(availabilityNudgesTable.toUserId, userId),
          ),
        );

      // --- Feed: own posts (cascade reactions/comments) + reactions/comments elsewhere.
      await tx.delete(feedPostsTable).where(eq(feedPostsTable.authorId, userId));
      await tx.delete(feedReactionsTable).where(eq(feedReactionsTable.userId, userId));
      await tx.delete(feedCommentsTable).where(eq(feedCommentsTable.authorId, userId));

      // --- Moments: own moments (cascade views/reactions) + views/reactions elsewhere.
      await tx.delete(momentsTable).where(eq(momentsTable.authorId, userId));
      await tx.delete(momentViewsTable).where(eq(momentViewsTable.viewerId, userId));
      await tx.delete(momentReactionsTable).where(eq(momentReactionsTable.userId, userId));

      // --- Friendships (both directions).
      await tx
        .delete(friendshipsTable)
        .where(or(eq(friendshipsTable.ownerId, userId), eq(friendshipsTable.friendId, userId)));

      // --- Squad-removal notices + object-upload ownership records.
      await tx.delete(squadRemovalNoticesTable).where(eq(squadRemovalNoticesTable.userId, userId));
      await tx.delete(objectUploadsTable).where(eq(objectUploadsTable.ownerId, userId));

      // --- Sessions referencing the user (best-effort; token auth is primary).
      await tx.execute(sql`DELETE FROM sessions WHERE sess::text LIKE ${"%" + userId + "%"}`);

      // --- Finally the user row (cascades auth_tokens via FK).
      await tx.delete(usersTable).where(eq(usersTable.id, userId));
    });

    logger.info({ userId }, "Account permanently deleted");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, userId }, "Error deleting account");
    res.status(500).json({ error: "Failed to delete your account. Please try again." });
  }
});

export default router;
