import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import {
  db,
  squadInvitesTable,
  eventInvitesTable,
  squadsTable,
  eventsTable,
  usersTable,
  activityTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { FREE_SQUAD_LIMIT, withSquadLimit } from "../lib/squadLimit";
import { withPlanSlot, planLimitResponse } from "../lib/planLimit";
import { logger } from "../lib/logger";
import { recordActivitySafe } from "../lib/activity";
import { emitSquadUpdate } from "../lib/squadEvents";
import { emitEventUpdate } from "../lib/eventUpdates";
import { emitActivityUpdate } from "../lib/activityEvents";

const router: IRouter = Router();

/**
 * Aborts an invite-accept transaction so Postgres rolls back everything the
 * callback wrote. Thrown (not returned) because rolling back is the whole
 * point: a partial accept — invite flipped but membership missing, or a ledger
 * row spent on a squad that vanished — is worse than no accept at all.
 */
class InviteAbort extends Error {
  constructor(readonly reason: "conflict" | "gone") {
    super(reason);
    this.name = "InviteAbort";
  }
}

// ─── Squad invites ────────────────────────────────────────────────────────────

router.get("/squads/invites/pending", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  try {
    const invites = await db
      .select()
      .from(squadInvitesTable)
      .where(and(eq(squadInvitesTable.invitedUserId, userId), eq(squadInvitesTable.status, "pending")))
      .orderBy(desc(squadInvitesTable.createdAt));
    if (invites.length === 0) {
      res.json([]);
      return;
    }
    const inviterIds = [...new Set(invites.map((i) => i.inviterUserId))];
    const inviters = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, profileImageUrl: usersTable.profileImageUrl })
      .from(usersTable)
      .where(inArray(usersTable.id, inviterIds));
    const inviterMap = new Map(inviters.map((u) => [u.id, u]));
    res.json(invites.map((i) => ({ ...i, inviter: inviterMap.get(i.inviterUserId) ?? null })));
  } catch (err) {
    logger.error({ err }, "Error fetching pending squad invites");
    res.status(500).json({ error: "Failed to fetch invites" });
  }
});

router.post("/squads/invites/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const inviteId = req.params.id as string;
  const userId = (req.user as { id: string }).id;
  try {
    const [invite] = await db
      .select()
      .from(squadInvitesTable)
      .where(and(eq(squadInvitesTable.id, inviteId), eq(squadInvitesTable.invitedUserId, userId), eq(squadInvitesTable.status, "pending")));
    if (!invite) {
      res.status(404).json({ error: "Invite not found or already actioned" });
      return;
    }
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, invite.squadId));
    if (!squad) {
      res.status(404).json({ error: "Squad no longer exists" });
      return;
    }
    const alreadyMember = (squad.memberIds as string[]).includes(userId);

    // Accepting is the moment membership (and therefore the free squad cap) is
    // consumed — a pending invite never counts. Every write lives in ONE
    // transaction: the pending→accepted flip, the membership append, the
    // history ledger row and the activity cleanup. Anything less and the
    // accounting drifts from reality — a membership without its ledger row is a
    // permanently free extra slot, and a ledger row without the membership
    // burns 1 of only 3 slots on a squad the user never joined.
    let outcome: Awaited<ReturnType<typeof withSquadLimit<boolean>>>;
    try {
      outcome = await withSquadLimit(
        userId,
        !alreadyMember,
        async (tx) => {
          // The status='pending' predicate serialises simultaneous accepts at
          // the DB level: exactly one UPDATE matches and the rest get 0 rows,
          // so the side effects below can only run once.
          const [flipped] = await tx
            .update(squadInvitesTable)
            .set({ status: "accepted" })
            .where(and(eq(squadInvitesTable.id, inviteId), eq(squadInvitesTable.status, "pending")))
            .returning({ id: squadInvitesTable.id });
          if (!flipped) throw new InviteAbort("conflict");

          // NOT @> guard keeps the append idempotent: a concurrent join can't
          // be duplicated into member_ids.
          const joinedRows = await tx
            .update(squadsTable)
            .set({
              memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb`,
              version: sql`${squadsTable.version} + 1`,
            })
            .where(
              and(
                eq(squadsTable.id, invite.squadId),
                sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
              ),
            )
            .returning();

          if (joinedRows.length === 0) {
            // Zero rows is either "already a member" (idempotent, fine) or
            // "squad deleted while this accept was in flight". Re-read inside
            // the tx to tell them apart; aborting rolls the invite flip back so
            // it does NOT end up accepted into a squad that no longer exists.
            const [current] = await tx
              .select()
              .from(squadsTable)
              .where(eq(squadsTable.id, invite.squadId));
            if (!current) throw new InviteAbort("gone");
          }

          await tx
            .delete(activityTable)
            .where(and(eq(activityTable.type, "squad_invite"), eq(activityTable.subjectId, inviteId)));
          return joinedRows.length > 0;
        },
        // Ledger row commits with the membership append, and ONLY when this
        // accept actually produced (or already had) the membership. A zero-row
        // update must not be charged.
        (joined) => (joined || alreadyMember ? invite.squadId : null),
      );
    } catch (err) {
      if (err instanceof InviteAbort) {
        if (err.reason === "gone") {
          res.status(404).json({ error: "Squad no longer exists" });
        } else {
          res.status(409).json({ error: "Invite was already accepted", conflict: true });
        }
        return;
      }
      throw err;
    }
    if (!outcome.ok) {
      // Capped: nothing was written, so the invite stays pending and becomes
      // acceptable the moment they upgrade.
      res.status(403).json({
        error: `Free plan is limited to ${FREE_SQUAD_LIMIT} squads. Upgrade to SquadZ+ to join more.`,
        code: "SQUAD_LIMIT",
        limit: FREE_SQUAD_LIMIT,
      });
      return;
    }
    res.json({ ok: true, squadId: invite.squadId });
    emitSquadUpdate(invite.squadId);
    emitActivityUpdate(userId);
    recordActivitySafe({
      recipientId: invite.inviterUserId,
      actorId: userId,
      type: "squad_join",
      subjectType: "squad",
      subjectId: invite.squadId,
      meta: { subjectName: invite.squadName, subjectEmoji: invite.squadEmoji, squadId: invite.squadId },
    });
  } catch (err) {
    logger.error({ err }, "Error accepting squad invite");
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

router.post("/squads/invites/:id/decline", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const inviteId = req.params.id as string;
  const userId = (req.user as { id: string }).id;
  try {
    const [invite] = await db
      .select()
      .from(squadInvitesTable)
      .where(and(eq(squadInvitesTable.id, inviteId), eq(squadInvitesTable.invitedUserId, userId), eq(squadInvitesTable.status, "pending")));
    if (!invite) {
      res.status(404).json({ error: "Invite not found or already actioned" });
      return;
    }
    await db.update(squadInvitesTable).set({ status: "declined" }).where(eq(squadInvitesTable.id, inviteId));
    await db.delete(activityTable).where(and(eq(activityTable.type, "squad_invite"), eq(activityTable.subjectId, inviteId)));
    res.json({ ok: true });
    emitActivityUpdate(userId);
  } catch (err) {
    logger.error({ err }, "Error declining squad invite");
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

// ─── Event / trip invites ─────────────────────────────────────────────────────

router.get("/events/invites/pending", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  try {
    const invites = await db
      .select()
      .from(eventInvitesTable)
      .where(and(eq(eventInvitesTable.invitedUserId, userId), eq(eventInvitesTable.status, "pending")))
      .orderBy(desc(eventInvitesTable.createdAt));
    if (invites.length === 0) {
      res.json([]);
      return;
    }
    const inviterIds = [...new Set(invites.map((i) => i.inviterUserId))];
    const inviters = await db
      .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, profileImageUrl: usersTable.profileImageUrl })
      .from(usersTable)
      .where(inArray(usersTable.id, inviterIds));
    const inviterMap = new Map(inviters.map((u) => [u.id, u]));
    res.json(invites.map((i) => ({ ...i, inviter: inviterMap.get(i.inviterUserId) ?? null })));
  } catch (err) {
    logger.error({ err }, "Error fetching pending event invites");
    res.status(500).json({ error: "Failed to fetch invites" });
  }
});

router.post("/events/invites/:id/accept", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const inviteId = req.params.id as string;
  const userId = (req.user as { id: string }).id;
  try {
    const [invite] = await db
      .select()
      .from(eventInvitesTable)
      .where(and(eq(eventInvitesTable.id, inviteId), eq(eventInvitesTable.invitedUserId, userId), eq(eventInvitesTable.status, "pending")));
    if (!invite) {
      res.status(404).json({ error: "Invite not found or already actioned" });
      return;
    }
    // Accepting is the moment the plan slot is consumed — a pending invite
    // never counts against the free-tier cap, so the user can sit on an invite
    // indefinitely and only pay for it when they opt in. A capped user's invite
    // stays pending and becomes acceptable the moment they upgrade.
    //
    // The accept writes run INSIDE the claim's transaction: all four (ledger
    // row, invite status, event access, activity cleanup) are one atomic unit.
    // If any fails the others roll back. Without that, the status could flip to
    // "accepted" while invitedUserIds was not updated, or — worse — the LOSER
    // of two simultaneous accepts (which writes nothing and 409s) would still
    // have spent one of only three free plan slots.
    //
    // The invite status UPDATE deliberately includes a status='pending'
    // predicate so that two simultaneous accepts are serialised at the DB
    // level: exactly one UPDATE matches the row and the other gets 0 rows back,
    // preventing duplicate side effects (duplicate invitedUserIds entries,
    // duplicate activity records).
    const slot = await withPlanSlot(
      userId,
      invite.eventId,
      async (tx) => {
        const [flipped] = await tx
          .update(eventInvitesTable)
          .set({ status: "accepted" })
          .where(and(eq(eventInvitesTable.id, inviteId), eq(eventInvitesTable.status, "pending")))
          .returning({ id: eventInvitesTable.id });
        if (!flipped) return false; // another concurrent accept already won — skip side effects

        // Access is granted ONLY through events.invited_user_ids, so this
        // update is the accept. It must match a row: if the event was deleted
        // between the invite lookup and here, an accept that "succeeded"
        // without it would leave the invite marked accepted and a plan slot
        // spent on an event the user can never open.
        const granted = await tx
          .update(eventsTable)
          .set({
            invitedUserIds: sql`(
              SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
              FROM jsonb_array_elements(
                COALESCE(${eventsTable.invitedUserIds}, '[]'::jsonb) || ${JSON.stringify([userId])}::jsonb
              ) AS elem
            )`,
            version: sql`${eventsTable.version} + 1`,
          })
          .where(eq(eventsTable.id, invite.eventId))
          .returning({ id: eventsTable.id });
        // Throwing (not returning) is deliberate: it rolls back the invite flip
        // and any ledger row, leaving the invite pending.
        if (granted.length === 0) throw new InviteAbort("gone");

        await tx.delete(activityTable).where(and(eq(activityTable.type, "event_invite"), eq(activityTable.subjectId, inviteId)));
        return true;
      },
      // Only the accept that actually won charges a slot.
      (acceptWon) => acceptWon,
    );
    if (!slot.ok) {
      res.status(403).json(planLimitResponse(slot));
      return;
    }
    if (!slot.value) {
      res.status(409).json({ error: "Invite was already accepted", conflict: true });
      return;
    }
    res.json({ ok: true, eventId: invite.eventId });
    emitEventUpdate(invite.eventId);
    emitActivityUpdate(userId);
  } catch (err) {
    logger.error({ err }, "Error accepting event invite");
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

router.post("/events/invites/:id/decline", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const inviteId = req.params.id as string;
  const userId = (req.user as { id: string }).id;
  try {
    const [invite] = await db
      .select()
      .from(eventInvitesTable)
      .where(and(eq(eventInvitesTable.id, inviteId), eq(eventInvitesTable.invitedUserId, userId), eq(eventInvitesTable.status, "pending")));
    if (!invite) {
      res.status(404).json({ error: "Invite not found or already actioned" });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.update(eventInvitesTable).set({ status: "declined" }).where(eq(eventInvitesTable.id, inviteId));
      await tx.delete(activityTable).where(and(eq(activityTable.type, "event_invite"), eq(activityTable.subjectId, inviteId)));
    });
    res.json({ ok: true });
    emitActivityUpdate(userId);
  } catch (err) {
    logger.error({ err }, "Error declining event invite");
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

export default router;
