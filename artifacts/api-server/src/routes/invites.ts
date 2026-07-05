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
import { logger } from "../lib/logger";
import { recordActivitySafe } from "../lib/activity";
import { emitSquadUpdate } from "../lib/squadEvents";
import { emitEventUpdate } from "../lib/eventUpdates";
import { emitActivityUpdate } from "../lib/activityEvents";

const router: IRouter = Router();

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
    if (!alreadyMember) {
      // Accepting is the moment membership (and therefore the free squad cap)
      // is consumed — a pending invite never counts. Enforce the cap atomically,
      // same as join-via-code, and keep the invite pending so the user can
      // upgrade and accept afterwards.
      const outcome = await withSquadLimit(userId, true, (tx) =>
        tx
          .update(squadsTable)
          .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb` })
          .where(eq(squadsTable.id, invite.squadId)),
      );
      if (!outcome.ok) {
        res.status(403).json({
          error: `Free plan is limited to ${FREE_SQUAD_LIMIT} squads. Upgrade to Squadz+ to join more.`,
          code: "SQUAD_LIMIT",
          limit: FREE_SQUAD_LIMIT,
        });
        return;
      }
    }
    await db.update(squadInvitesTable).set({ status: "accepted" }).where(eq(squadInvitesTable.id, inviteId));
    await db.delete(activityTable).where(and(eq(activityTable.type, "squad_invite"), eq(activityTable.subjectId, inviteId)));
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
    await db
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
      .where(eq(eventsTable.id, invite.eventId));
    await db.update(eventInvitesTable).set({ status: "accepted" }).where(eq(eventInvitesTable.id, inviteId));
    await db.delete(activityTable).where(and(eq(activityTable.type, "event_invite"), eq(activityTable.subjectId, inviteId)));
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
    await db.update(eventInvitesTable).set({ status: "declined" }).where(eq(eventInvitesTable.id, inviteId));
    await db.delete(activityTable).where(and(eq(activityTable.type, "event_invite"), eq(activityTable.subjectId, inviteId)));
    res.json({ ok: true });
    emitActivityUpdate(userId);
  } catch (err) {
    logger.error({ err }, "Error declining event invite");
    res.status(500).json({ error: "Failed to decline invite" });
  }
});

export default router;
