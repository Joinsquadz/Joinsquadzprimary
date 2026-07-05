import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { z } from "zod";
import {
  db,
  squadsTable,
  usersTable,
  squadMutesTable,
  squadRemovalNoticesTable,
  squadInvitesTable,
  activityTable,
  eventsTable,
  eventInvitesTable,
  conversationsTable,
  photosTable,
  availabilityPollsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitSquadUpdate, onSquadUpdate } from "../lib/squadEvents";
import { recordActivitySafe } from "../lib/activity";
import { resolveProStatusForIds } from "../lib/proStatus";
import { FREE_SQUAD_LIMIT, withSquadLimit } from "../lib/squadLimit";

function generateInviteCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

async function getSquadIfMember(squadId: string, userId: string) {
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, squadId));
  if (!squad) return { squad: null, isMember: false };
  const memberIds = (squad.memberIds ?? []) as string[];
  return { squad, isMember: memberIds.includes(userId) };
}

/**
 * Purge all data scoped to a squad when the squad itself is deleted, so no
 * orphaned events/chats/invites/polls linger and members' own photos are
 * returned to their personal vaults.
 *
 * Runs inside the same transaction as the squad deletion. Children with
 * `onDelete: "cascade"` FKs (conversation participants/messages, availability
 * responses/nudges, event photos) are removed automatically by their parent
 * deletes; event invites have no FK so they are deleted explicitly.
 */
async function purgeSquadData(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  squadId: string,
): Promise<void> {
  const squadEvents = await tx
    .select({ id: eventsTable.id })
    .from(eventsTable)
    .where(eq(eventsTable.squadId, squadId));
  const eventIds = squadEvents.map((e) => e.id);
  if (eventIds.length > 0) {
    await tx.delete(eventInvitesTable).where(inArray(eventInvitesTable.eventId, eventIds));
    await tx.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  }
  await tx.delete(conversationsTable).where(eq(conversationsTable.squadId, squadId));
  await tx.delete(squadInvitesTable).where(eq(squadInvitesTable.squadId, squadId));
  await tx.delete(availabilityPollsTable).where(eq(availabilityPollsTable.squadId, squadId));
  // Vault roll-ups are members' OWN photos shared to the squad — unshare them
  // (they remain in each owner's personal vault); never delete user photos.
  await tx
    .update(photosTable)
    .set({ squadId: null, sharedToSquad: false })
    .where(eq(photosTable.squadId, squadId));
}

// "Help manage" rights: the creator plus any co-admin may change squad settings
// and manage members/invites. Deleting the squad and changing co-admins stay
// creator-only.
function canManageSquad(
  squad: typeof squadsTable.$inferSelect,
  userId: string,
): boolean {
  return squad.creatorId === userId || ((squad.coAdminIds ?? []) as string[]).includes(userId);
}

const CoAdminBody = z.object({ userId: z.string().min(1) });

const ShareToVaultBody = z.object({
  photoIds: z.array(z.number().int()).min(1),
});

const CreateSquadBody = z.object({
  name: z.string().min(1),
  description: z.string().trim().max(280).optional(),
  emoji: z.string().default("👥"),
  color: z.string().default("#FF5C3A"),
  memberIds: z.array(z.string()).default([]),
  isPublic: z.boolean().default(false),
});

const UpdateSquadBody = z.object({
  name: z.string().optional(),
  description: z.string().trim().max(280).nullable().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
  isPublic: z.boolean().optional(),
  membersCanInvite: z.boolean().optional(),
  memberIds: z.array(z.string()).optional(),
  version: z.number().int().optional(),
});

router.post("/squads/:id/join", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!squad.isPublic) {
    res.status(403).json({ error: "This squad is private. Use an invite link to join." });
    return;
  }
  // Snapshot pre-join members for notification targeting (before the update).
  const memberIds = (squad.memberIds ?? []) as string[];

  // Free squad limit + atomic append in one transaction. withSquadLimit takes a
  // per-user advisory lock and re-counts inside the tx, so concurrent joins for
  // the same free user can't push them past the cap (TOCTOU-safe). Already-members
  // skip the cap (enforce = false) so a re-join stays an idempotent no-op. The
  // WHERE NOT @> guard still ensures no member is silently overwritten; 0 rows
  // returned means the user was already a member.
  const alreadyMember = memberIds.includes(userId);
  const outcome = await withSquadLimit(userId, !alreadyMember, (tx) =>
    tx
      .update(squadsTable)
      .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb` })
      .where(
        and(
          eq(squadsTable.id, id),
          sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
        ),
      )
      .returning(),
  );
  if (!outcome.ok) {
    res.status(403).json({
      error: `Free plan is limited to ${FREE_SQUAD_LIMIT} squads. Upgrade to Squadz+ to join more.`,
      code: "SQUAD_LIMIT",
      limit: FREE_SQUAD_LIMIT,
    });
    return;
  }
  const [updated] = outcome.value;

  if (!updated) {
    res.json({ squad, alreadyMember: true });
    return;
  }
  res.status(201).json({ squad: updated, alreadyMember: false });
  emitSquadUpdate(id);
  if (squad.creatorId) {
    recordActivitySafe({
      recipientId: squad.creatorId,
      actorId: userId,
      type: "squad_join",
      subjectType: "squad",
      subjectId: id,
      meta: { subjectName: squad.name, subjectEmoji: squad.emoji, squadId: id },
    });
  }

  // Fire-and-forget: notify existing members that someone joined, and send a
  // welcome push to the joiner themselves.
  (async () => {
    try {
      const joiner = await storage.getUser(userId);
      const joinerName = joiner?.firstName ?? "Someone";

      // Notify pre-existing members (opt-in gated).
      if (memberIds.length > 0) {
        const unmuted = await storage.filterUnmutedForSquad(memberIds, id);
        if (unmuted.length > 0) {
          const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifySquadJoin: true });
          if (tokens.length > 0) {
            await sendPushNotifications(
              tokens,
              {
                title: squad.name,
                body: `${joinerName} joined ${squad.name}`,
                data: { screen: "squad", squadId: id },
              },
              { onStaleToken: (token) => storage.clearPushToken(token) },
            );
          }
        }
      }

      // Welcome push to the joiner (not opt-in gated).
      const joinerTokens = await storage.getPushTokensForUsers([userId]);
      if (joinerTokens.length > 0) {
        await sendPushNotifications(
          joinerTokens,
          {
            title: `Welcome to ${squad.name}!`,
            body: `You're now part of "${squad.name}"`,
            data: { screen: "squad", squadId: id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending squad-join push notifications");
    }
  })();
});

router.post("/squads/join-via-code", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Invite code is required." });
    return;
  }
  const [squad] = await db
    .select()
    .from(squadsTable)
    .where(eq(squadsTable.inviteCode, code.trim().toUpperCase()));
  if (!squad) {
    res.status(404).json({ error: "Invite link is invalid or has expired." });
    return;
  }
  // Snapshot pre-join members for notification targeting (before the update).
  const memberIds = (squad.memberIds ?? []) as string[];

  // Free squad limit + atomic append in one transaction (see /squads/:id/join).
  // The advisory-lock re-count makes the cap TOCTOU-safe under concurrent
  // invite-link joins; the WHERE NOT @> guard prevents lost-update overwrites.
  const alreadyMember = memberIds.includes(userId);
  const outcome = await withSquadLimit(userId, !alreadyMember, (tx) =>
    tx
      .update(squadsTable)
      .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb` })
      .where(
        and(
          eq(squadsTable.id, squad.id),
          sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
        ),
      )
      .returning(),
  );
  if (!outcome.ok) {
    res.status(403).json({
      error: `Free plan is limited to ${FREE_SQUAD_LIMIT} squads. Upgrade to Squadz+ to join more.`,
      code: "SQUAD_LIMIT",
      limit: FREE_SQUAD_LIMIT,
    });
    return;
  }
  const [updated] = outcome.value;

  if (!updated) {
    res.json({ squad, alreadyMember: true });
    return;
  }
  res.status(201).json({ squad: updated, alreadyMember: false });
  emitSquadUpdate(squad.id);

  // Fire-and-forget: notify existing members that someone joined via invite link.
  if (memberIds.length > 0) {
    (async () => {
      try {
        const joiner = await storage.getUser(userId);
        const joinerName = joiner?.firstName ?? "Someone";
        const unmuted = await storage.filterUnmutedForSquad(memberIds, squad.id);
        if (unmuted.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifySquadJoin: true });
        await sendPushNotifications(
          tokens,
          {
            title: squad.name,
            body: `${joinerName} joined ${squad.name}`,
            data: { screen: "squad", squadId: squad.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-join-via-code push notifications");
      }
    })();
  }
});

router.get("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const [squads, mutedIds] = await Promise.all([
    db
      .select()
      .from(squadsTable)
      .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`)
      .orderBy(squadsTable.createdAt),
    storage.getMutedSquadIdsForUser(userId),
  ]);
  const mutedSet = new Set(mutedIds);
  res.json(squads.map((s) => ({ ...s, muted: mutedSet.has(s.id) })));
});

router.post("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req.user as { id: string }).id;

  // Free squad limit + atomic create: creating a squad counts toward the cap, so
  // re-count under a per-user advisory lock inside the tx to block concurrent
  // creates from exceeding it.
  //
  // Consent: selected friends are NOT added as members directly. Membership
  // requires acceptance (it consumes the invitee's free squad cap), so the
  // creator's picks become pending squad invites the invitee can Accept or
  // Decline from their Activity tab — mirroring POST /squads/:id/members.
  const memberIds = [userId];
  const invitedIds = Array.from(new Set(parsed.data.memberIds)).filter((id) => id !== userId);
  const inviteCode = generateInviteCode();
  const outcome = await withSquadLimit(userId, true, (tx) =>
    tx
      .insert(squadsTable)
      .values({ ...parsed.data, memberIds, creatorId: userId, inviteCode })
      .returning(),
  );
  if (!outcome.ok) {
    res.status(403).json({
      error: `Free plan is limited to ${FREE_SQUAD_LIMIT} squads. Upgrade to Squadz+ to create more.`,
      code: "SQUAD_LIMIT",
      limit: FREE_SQUAD_LIMIT,
    });
    return;
  }
  const [squad] = outcome.value;

  // Create pending invites for the picked friends (only for users that exist).
  let invitedUserIds: string[] = [];
  if (invitedIds.length > 0) {
    try {
      const targets = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, invitedIds));
      invitedUserIds = targets.map((t) => t.id);
      if (invitedUserIds.length > 0) {
        const invites = await db
          .insert(squadInvitesTable)
          .values(
            invitedUserIds.map((invitedUserId) => ({
              squadId: squad.id,
              inviterUserId: userId,
              invitedUserId,
              squadName: squad.name,
              squadEmoji: squad.emoji,
            })),
          )
          .returning();
        for (const invite of invites) {
          recordActivitySafe({
            recipientId: invite.invitedUserId,
            actorId: userId,
            type: "squad_invite",
            subjectType: "squad",
            subjectId: invite.id,
            meta: { subjectName: squad.name, subjectEmoji: squad.emoji, squadId: squad.id },
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Error creating squad invites at squad creation");
    }
  }

  res.status(201).json({ ...squad, pendingInvitedUserIds: invitedUserIds });

  // Fire-and-forget: push-notify the invitees about their pending invite.
  if (invitedUserIds.length > 0) {
    (async () => {
      try {
        const creator = await storage.getUser(userId);
        const creatorName = creator?.firstName
          ? creator.lastName
            ? `${creator.firstName} ${creator.lastName}`
            : creator.firstName
          : "Someone";
        const tokens = await storage.getPushTokensForUsers(invitedUserIds, { requireNotifySquadJoin: true });
        if (tokens.length === 0) return;
        await sendPushNotifications(
          tokens,
          {
            title: "Squad invite",
            body: `${creatorName} invited you to join "${squad.name}"`,
            data: { screen: "activity" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-invite push notifications");
      }
    })();
  }
});

router.get("/squads/muted", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const squads = await storage.getMutedSquadsForUser(userId);
  res.json({ squads });
});

// GET /api/squads/stream — User-level SSE stream for all squad updates.
// Opens a single long-lived connection that covers every squad the
// authenticated user currently belongs to. Any mutation on any of those
// squads (PATCH, join, leave, add/remove member) pushes an "update" event
// immediately. The client can call refreshSquads() and all screens sharing
// AppContext will reflect the change without requiring a focus-switch.
router.get("/squads/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;

  const allSquads = await db.select({ id: squadsTable.id, memberIds: squadsTable.memberIds }).from(squadsTable);
  const squadIds = allSquads
    .filter((s) => ((s.memberIds ?? []) as string[]).includes(userId))
    .map((s) => s.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const unsubscribers = squadIds.map((sid) =>
    onSquadUpdate(sid, () => {
      res.write(`event: update\ndata: {"squadId":"${sid}"}\n\n`);
    }),
  );

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribers.forEach((u) => u());
  });
});

router.get("/squads/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  const memberIds = (squad.memberIds ?? []) as string[];
  if (!memberIds.includes(userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const members =
    memberIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            profileImageUrl: usersTable.profileImageUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, memberIds))
      : [];
  const proMap = await resolveProStatusForIds(memberIds);
  const membersWithPro = members.map((m) => ({ ...m, isPro: proMap[m.id] ?? false }));
  res.json({ ...squad, members: membersWithPro });
});

// GET /api/squads/:id/stream — SSE endpoint for real-time squad updates.
// Members connect while the squad detail screen is focused. Any mutation
// (PATCH, join, leave, add/remove member) calls emitSquadUpdate(id) which
// pushes an "update" event to all connected watchers immediately.
router.get("/squads/:id/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;

  // Verify membership before opening the stream.
  const { squad, isMember } = await getSquadIfMember(id, userId);
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!isMember) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // SSE response headers.
  // no-transform stops the compression middleware from buffering the stream.
  // X-Accel-Buffering: no disables nginx / Replit proxy buffering.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Confirm connection to the client.
  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = onSquadUpdate(id, () => {
    res.write(`event: update\ndata: {"squadId":"${id}"}\n\n`);
  });

  // Keep-alive heartbeat every 25 s to prevent proxy/mobile connection timeouts.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.patch("/squads/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = UpdateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  const memberIds = (existing.memberIds ?? []) as string[];
  if (!memberIds.includes(userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // The creator or a co-admin can change invite permissions.
  if (parsed.data.membersCanInvite !== undefined && !canManageSquad(existing, userId)) {
    res.status(403).json({ error: "Only the squad creator or a co-admin can change invite permissions." });
    return;
  }

  // Consent-gated membership: PATCH may never inject users directly into
  // memberIds. Additions become pending invites (Accept/Decline from the
  // Activity tab — same as squad creation and POST /squads/:id/members);
  // removals of existing members are applied as-is.
  const requestedAdds = parsed.data.memberIds
    ? Array.from(new Set(parsed.data.memberIds.filter((mid) => !memberIds.includes(mid) && mid !== userId)))
    : [];
  if (requestedAdds.length > 0) {
    const membersCanInvite = ((existing.membersCanInvite as boolean | null) ?? false) || canManageSquad(existing, userId);
    if (!membersCanInvite) {
      res.status(403).json({ error: "Only the squad creator can add members" });
      return;
    }
  }

  const { version: clientVersion, ...fieldsToUpdate } = parsed.data;
  if (fieldsToUpdate.memberIds) {
    // Strip additions — keep only ids that are already members (allows removals/reorder).
    fieldsToUpdate.memberIds = fieldsToUpdate.memberIds.filter((mid) => memberIds.includes(mid));
  }
  const updateWhere = clientVersion !== undefined
    ? and(eq(squadsTable.id, id), eq(squadsTable.version, clientVersion))
    : eq(squadsTable.id, id);
  const [squad] = await db
    .update(squadsTable)
    .set({ ...fieldsToUpdate, version: sql`${squadsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!squad) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }

  // Create pending invites for the requested additions (existing users only,
  // skipping anyone who already has a pending invite).
  let pendingInvitedUserIds: string[] = [];
  if (requestedAdds.length > 0) {
    try {
      const targets = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(inArray(usersTable.id, requestedAdds));
      const existingPending = await db
        .select({ invitedUserId: squadInvitesTable.invitedUserId })
        .from(squadInvitesTable)
        .where(
          and(
            eq(squadInvitesTable.squadId, id),
            inArray(squadInvitesTable.invitedUserId, targets.map((t) => t.id)),
            eq(squadInvitesTable.status, "pending"),
          ),
        );
      const alreadyPending = new Set(existingPending.map((i) => i.invitedUserId));
      const toInvite = targets.map((t) => t.id).filter((tid) => !alreadyPending.has(tid));
      if (toInvite.length > 0) {
        // Upsert: a prior declined (or stale accepted — the user is no longer a
        // member, else they wouldn't be in requestedAdds) row is re-opened to
        // pending instead of colliding with uniq_squad_invite_per_squad.
        const invites = await db
          .insert(squadInvitesTable)
          .values(
            toInvite.map((invitedUserId) => ({
              squadId: id,
              inviterUserId: userId,
              invitedUserId,
              squadName: squad.name,
              squadEmoji: squad.emoji,
            })),
          )
          .onConflictDoUpdate({
            target: [squadInvitesTable.squadId, squadInvitesTable.invitedUserId],
            set: {
              status: "pending",
              inviterUserId: userId,
              squadName: squad.name,
              squadEmoji: squad.emoji,
              createdAt: sql`now()`,
            },
            // Don't downgrade an invite the user accepted concurrently — they
            // just became a member, so no re-invite is needed.
            setWhere: sql`${squadInvitesTable.status} <> 'accepted'`,
          })
          .returning();
        pendingInvitedUserIds = invites.map((i) => i.invitedUserId);
        for (const invite of invites) {
          recordActivitySafe({
            recipientId: invite.invitedUserId,
            actorId: userId,
            type: "squad_invite",
            subjectType: "squad",
            subjectId: invite.id,
            meta: { subjectName: squad.name, subjectEmoji: squad.emoji, squadId: id },
          });
        }
      }
    } catch (err) {
      logger.error({ err, squadId: id }, "Error creating squad invites from PATCH member additions");
      // The squad field update already applied, but the requested additions were
      // NOT converted to invites — surface the failure instead of a false success.
      res.status(500).json({ error: "Squad updated, but the invites could not be sent — please try again" });
      return;
    }
  }

  res.json({ ...squad, pendingInvitedUserIds });
  emitSquadUpdate(id);

  // Fire-and-forget: push-notify the invitees about their pending invite.
  if (pendingInvitedUserIds.length > 0) {
    const inviteeIds = pendingInvitedUserIds;
    (async () => {
      try {
        const adder = await storage.getUser(userId);
        const adderName = adder?.firstName
          ? adder.lastName
            ? `${adder.firstName} ${adder.lastName}`
            : adder.firstName
          : "Someone";
        const tokens = await storage.getPushTokensForUsers(inviteeIds, { requireNotifySquadJoin: true });
        if (tokens.length === 0) return;
        await sendPushNotifications(
          tokens,
          {
            title: "Squad invite",
            body: `${adderName} invited you to join "${squad.name}"`,
            data: { screen: "activity" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-invite push notifications");
      }
    })();
  }
});

router.delete("/squads/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  const memberIds = (existing.memberIds ?? []) as string[];
  if (!memberIds.includes(userId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  if (existing.creatorId !== userId) {
    res.status(403).json({ error: "Only the squad creator can delete the squad. Use the leave option to remove yourself." });
    return;
  }
  // Wrap all deletions in a transaction so a mid-flight crash never leaves
  // orphaned rows (mutes, events, chats, invites, polls): all or nothing.
  await db.transaction(async (tx) => {
    await purgeSquadData(tx, id);
    await tx.delete(squadsTable).where(eq(squadsTable.id, id));
    await tx.delete(squadMutesTable).where(eq(squadMutesTable.squadId, id));
  });

  res.sendStatus(204);

  // Fire-and-forget: notify all other members that the squad has been deleted.
  const otherMembers = memberIds.filter((mid) => mid !== userId);
  if (otherMembers.length > 0) {
    (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers(otherMembers);
        await sendPushNotifications(
          tokens,
          {
            title: "Squad deleted",
            body: `"${existing.name}" has been deleted`,
            data: { screen: "squads" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-deleted push notifications");
      }
    })();
  }
});

// Squad photo vault: curated photos members have rolled up to the squad.
router.get("/squads/:id/vault", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const { squad, isMember } = await getSquadIfMember(id, userId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    if (!isMember) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const rawPhotos = await storage.getSquadVaultPhotos(id);
    const favoriteIds = await storage.getUserFavoritePhotoIds(userId);
    // The squad vault is a shared, always-viewable surface; we only annotate each
    // item with whether the caller has personally favorited it.
    const photos = rawPhotos.map((p) => ({ ...p, favorited: favoriteIds.has(p.id) }));
    res.json({ photos });
  } catch (err) {
    logger.error({ err }, "Error fetching squad vault photos");
    res.status(500).json({ error: "Failed to fetch squad vault" });
  }
});

router.post("/squads/:id/vault", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const { squad, isMember } = await getSquadIfMember(id, userId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    if (!isMember) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const parsed = ShareToVaultBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Only the uploader's own photos are shared; others are silently ignored.
    const shared = await storage.setPhotosSharedToSquad(parsed.data.photoIds, userId, id);
    res.status(201).json({ shared: shared.length, photos: shared });

    // Fire-and-forget: tell the rest of the squad new photos hit the vault.
    if (shared.length > 0) {
      void (async () => {
        try {
          const memberIds = ((squad.memberIds ?? []) as string[]).filter((m) => m !== userId);
          if (memberIds.length === 0) return;
          const unmuted = await storage.filterUnmutedForSquad(memberIds, id);
          if (unmuted.length === 0) return;
          const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyFriendActivity: true });
          if (tokens.length === 0) return;
          const sharer = await storage.getUser(userId);
          const name = [sharer?.firstName, sharer?.lastName].filter(Boolean).join(" ").trim()
            || sharer?.email?.split("@")[0]
            || "Someone";
          const count = shared.length;
          await sendPushNotifications(
            tokens,
            {
              title: squad.name ?? "Squad photos",
              body: `${name} added ${count} photo${count === 1 ? "" : "s"} to the vault`,
              data: { screen: "vault", squadId: id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending vault push notifications");
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, "Error sharing photos to squad vault");
    res.status(500).json({ error: "Failed to share photos" });
  }
});

router.delete("/squads/:id/vault/:photoId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const photoId = parseInt(parseId(req.params.photoId), 10);
    if (Number.isNaN(photoId)) {
      res.status(400).json({ error: "Invalid photo id" });
      return;
    }
    const userId = (req.user as { id: string }).id;
    const { squad, isMember } = await getSquadIfMember(id, userId);
    if (!squad) {
      res.status(404).json({ error: "Squad not found" });
      return;
    }
    if (!isMember) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const removed = await storage.unsharePhotoFromSquad(photoId, userId, id);
    if (!removed) {
      res.status(404).json({ error: "Photo not found in your shared photos" });
      return;
    }
    res.sendStatus(204);
    // Nudge every member's squad stream so the photo disappears immediately,
    // matching how sharing a photo to the vault already broadcasts an update.
    emitSquadUpdate(id);
  } catch (err) {
    logger.error({ err }, "Error removing photo from squad vault");
    res.status(500).json({ error: "Failed to remove photo" });
  }
});

const AddMemberBody = z.object({
  friendCode: z.string().min(1),
});

const SetMuteBody = z.object({
  muted: z.boolean(),
});

router.get("/squads/:id/mute", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const { squad, isMember } = await getSquadIfMember(id, userId);
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!isMember) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const muted = await storage.isSquadMutedForUser(id, userId);
  res.json({ muted });
});

router.put("/squads/:id/mute", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = SetMuteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "muted (boolean) is required." });
    return;
  }
  const { squad, isMember } = await getSquadIfMember(id, userId);
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!isMember) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  await storage.setSquadMute(userId, id, parsed.data.muted);
  res.json({ muted: parsed.data.muted });
});

router.post("/squads/:id/members", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const requesterId = (req.user as { id: string }).id;
  const parsed = AddMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "friendCode is required." });
    return;
  }
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  const membersCanInvite = (squad.membersCanInvite as boolean | null) ?? false;
  if (!membersCanInvite && squad.creatorId !== requesterId) {
    res.status(403).json({ error: "Only the squad creator can add members" });
    return;
  }
  if (membersCanInvite && !(squad.memberIds as string[]).includes(requesterId)) {
    res.status(403).json({ error: "You must be a squad member to add others." });
    return;
  }
  const code = parsed.data.friendCode.toUpperCase().trim();
  const [target] = await db
    .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName, profileImageUrl: usersTable.profileImageUrl, friendCode: usersTable.friendCode })
    .from(usersTable)
    .where(eq(usersTable.friendCode, code));
  if (!target) {
    res.status(404).json({ error: "No user found with that friend code." });
    return;
  }
  const memberIds = (squad.memberIds ?? []) as string[];

  if (memberIds.includes(target.id)) {
    res.status(409).json({ error: "That user is already in the squad." });
    return;
  }

  // Check if there is already a pending invite for this user+squad.
  const [existingInvite] = await db
    .select({ id: squadInvitesTable.id })
    .from(squadInvitesTable)
    .where(
      and(
        eq(squadInvitesTable.squadId, id),
        eq(squadInvitesTable.invitedUserId, target.id),
        eq(squadInvitesTable.status, "pending"),
      ),
    );
  if (existingInvite) {
    res.status(409).json({ error: "An invite is already pending for that user." });
    return;
  }

  // Create the pending invite instead of adding directly — the invitee
  // will see it in their Activity tab and can Accept or Decline.
  const [invite] = await db
    .insert(squadInvitesTable)
    .values({
      squadId: id,
      inviterUserId: requesterId,
      invitedUserId: target.id,
      squadName: squad.name,
      squadEmoji: squad.emoji,
    })
    .returning();

  res.status(201).json({
    ok: true,
    inviteId: invite.id,
    invitedUser: { id: target.id, firstName: target.firstName, lastName: target.lastName },
  });

  // Notify the invitee via activity feed + push.
  recordActivitySafe({
    recipientId: target.id,
    actorId: requesterId,
    type: "squad_invite",
    subjectType: "squad",
    subjectId: invite.id,
    meta: { subjectName: squad.name, subjectEmoji: squad.emoji, squadId: id },
  });

  (async () => {
    try {
      const adder = await storage.getUser(requesterId);
      const adderName = adder?.firstName
        ? adder.lastName
          ? `${adder.firstName} ${adder.lastName}`
          : adder.firstName
        : "Someone";
      const unmuted = await storage.filterUnmutedForSquad([target.id], id);
      if (unmuted.length === 0) return;
      const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifySquadJoin: true });
      if (tokens.length === 0) return;
      await sendPushNotifications(
        tokens,
        {
          title: "Squad invite",
          body: `${adderName} invited you to join "${squad.name}"`,
          data: { screen: "activity" },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
    } catch (err) {
      logger.error({ err }, "Error sending squad-invite push notification");
    }
  })();
});

router.delete("/squads/:id/members/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const targetUserId = parseId(req.params.userId);
  const requesterId = (req.user as { id: string }).id;
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  const memberIds = (squad.memberIds ?? []) as string[];
  if (!memberIds.includes(requesterId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const isCreator = squad.creatorId === requesterId;
  const isManager = canManageSquad(squad, requesterId);
  const isSelf = requesterId === targetUserId;
  if (!isManager && !isSelf) {
    res.status(403).json({ error: "Only the squad creator, a co-admin, or the member themselves can remove a member." });
    return;
  }
  if (!memberIds.includes(targetUserId)) {
    res.status(404).json({ error: "User is not in this squad." });
    return;
  }
  if (isManager && targetUserId === squad.creatorId && !isSelf) {
    res.status(400).json({ error: "The creator cannot be removed. Transfer ownership or delete the squad instead." });
    return;
  }
  // A co-admin (who isn't the creator) cannot remove another co-admin — managing
  // co-admins is reserved for the creator.
  const targetIsCoAdmin = ((squad.coAdminIds ?? []) as string[]).includes(targetUserId);
  if (isManager && !isCreator && targetIsCoAdmin && !isSelf) {
    res.status(403).json({ error: "Only the squad creator can remove a co-admin." });
    return;
  }
  const updatedMemberIds = memberIds.filter((uid) => uid !== targetUserId);

  // Last member is leaving — delete the squad outright. Otherwise it would
  // become an orphan: only the creatorId may delete a squad, so a creator who
  // leaves as the final member would strand an empty, undeletable shell.
  if (updatedMemberIds.length === 0) {
    await db.transaction(async (tx) => {
      await purgeSquadData(tx, id);
      await tx.delete(squadsTable).where(eq(squadsTable.id, id));
      await tx.delete(squadMutesTable).where(eq(squadMutesTable.squadId, id));
    });
    res.json({ deleted: true });
    emitSquadUpdate(id);
    return;
  }

  // Ownership transfer: when the (effective) creator leaves but members remain,
  // hand the squad to the longest-standing remaining member. memberIds are kept
  // in join order, so the first remaining entry is the earliest joiner. This
  // also backfills creatorId on legacy squads where it was never set (mirrors
  // the client's `creatorId ?? memberIds[0]` fallback).
  const effectiveCreatorId = squad.creatorId ?? memberIds[0] ?? null;
  const nextCreatorId =
    effectiveCreatorId != null && targetUserId === effectiveCreatorId
      ? updatedMemberIds[0]
      : squad.creatorId;

  const [updatedSquad] = await db
    .update(squadsTable)
    .set({ memberIds: updatedMemberIds, creatorId: nextCreatorId })
    .where(eq(squadsTable.id, id))
    .returning();

  // Clean up any stale mute row for the removed user so orphaned rows
  // don't accumulate and don't cause confusion on re-join.
  await db
    .delete(squadMutesTable)
    .where(and(eq(squadMutesTable.userId, targetUserId), eq(squadMutesTable.squadId, id)));

  res.json(updatedSquad);
  emitSquadUpdate(id);

  // Fire-and-forget: prune the removed member's leftovers from this squad's
  // events — itinerary stop votes, poll votes, and their RSVP entry. Keeps
  // vote counts honest and revokes squad-event access that would otherwise
  // linger via the stale RSVP. Each update is version-checked (skip on
  // conflict) so it never clobbers a concurrent event write.
  void (async () => {
    try {
      const squadEvents = await db.select().from(eventsTable).where(eq(eventsTable.squadId, id));
      for (const ev of squadEvents) {
        let changed = false;
        const itinerary = ((ev.itinerary ?? []) as Array<{ votes?: string[] } & Record<string, unknown>>).map((s) => {
          if (Array.isArray(s.votes) && s.votes.includes(targetUserId)) {
            changed = true;
            return { ...s, votes: s.votes.filter((v) => v !== targetUserId) };
          }
          return s;
        });
        const polls = (
          (ev.polls ?? []) as Array<{ options?: Array<{ voterIds?: string[] } & Record<string, unknown>> } & Record<string, unknown>>
        ).map((p) => ({
          ...p,
          options: (p.options ?? []).map((o) => {
            if (Array.isArray(o.voterIds) && o.voterIds.includes(targetUserId)) {
              changed = true;
              return { ...o, voterIds: o.voterIds.filter((v) => v !== targetUserId) };
            }
            return o;
          }),
        }));
        const rsvps = { ...((ev.rsvps ?? {}) as Record<string, string>) };
        if (targetUserId in rsvps) {
          changed = true;
          delete rsvps[targetUserId];
        }
        if (!changed) continue;
        await db
          .update(eventsTable)
          .set({
            itinerary: itinerary as typeof ev.itinerary,
            polls: polls as typeof ev.polls,
            rsvps,
            version: sql`${eventsTable.version} + 1`,
          })
          .where(and(eq(eventsTable.id, ev.id), eq(eventsTable.version, ev.version)));
      }
    } catch (err) {
      logger.error({ err, squadId: id, targetUserId }, "Error pruning removed member's event data");
    }
  })();

  if (isSelf) {
    // Fire-and-forget: user left — notify remaining members.
    if (updatedMemberIds.length > 0) {
      (async () => {
        try {
          const leaver = await storage.getUser(targetUserId);
          const leaverName = leaver?.firstName
            ? leaver.lastName
              ? `${leaver.firstName} ${leaver.lastName}`
              : leaver.firstName
            : "Someone";
          const tokens = await storage.getPushTokensForUsers(updatedMemberIds, { requireNotifySquadLeave: true });
          await sendPushNotifications(
            tokens,
            {
              title: squad.name,
              body: `${leaverName} left ${squad.name}`,
              data: { screen: "squad", squadId: squad.id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending squad-left push notifications");
        }
      })();
    }
  } else {
    // Fire-and-forget: creator removed a member — record an in-app notice AND notify via push.
    (async () => {
      try {
        // Persist an in-app notice so the user sees it even if they missed the push.
        await db.insert(squadRemovalNoticesTable).values({
          userId: targetUserId,
          squadName: squad.name,
        });
      } catch (err) {
        logger.error({ err }, "Error inserting squad removal notice");
      }
      try {
        const tokens = await storage.getPushTokensForUsers([targetUserId], { requireNotifySquadLeave: true });
        await sendPushNotifications(
          tokens,
          {
            title: "Removed from squad",
            body: `You've been removed from "${squad.name}"`,
            data: { screen: "squads" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-removed push notification");
      }
    })();
  }
});

// Return all unseen removal notices for the authenticated user.
router.get("/squads/removal-notices", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const notices = await db
    .select()
    .from(squadRemovalNoticesTable)
    .where(and(eq(squadRemovalNoticesTable.userId, userId), isNull(squadRemovalNoticesTable.seenAt)));
  res.json(notices);
});

// Dismiss (mark as seen) a single removal notice.
router.delete("/squads/removal-notices/:noticeId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const noticeId = parseId(req.params.noticeId);
  const userId = (req.user as { id: string }).id;
  const [notice] = await db.select().from(squadRemovalNoticesTable).where(eq(squadRemovalNoticesTable.id, noticeId));
  if (!notice || notice.userId !== userId) {
    res.status(404).json({ error: "Notice not found" });
    return;
  }
  await db
    .update(squadRemovalNoticesTable)
    .set({ seenAt: new Date() })
    .where(eq(squadRemovalNoticesTable.id, noticeId));
  res.sendStatus(204);
});

router.post("/squads/:id/invite/regenerate", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!canManageSquad(existing, userId)) {
    res.status(403).json({ error: "Only the squad creator or a co-admin can regenerate the invite link." });
    return;
  }
  const newCode = generateInviteCode();
  const [updated] = await db
    .update(squadsTable)
    .set({ inviteCode: newCode })
    .where(eq(squadsTable.id, id))
    .returning();
  res.json(updated);
});

// Grant a co-admin "help manage" rights. Creator-only. Target must be a member.
router.post("/squads/:id/co-admins", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = CoAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const targetId = parsed.data.userId;
  const [existing] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (existing.creatorId !== userId) {
    res.status(403).json({ error: "Only the squad creator can change co-admins." });
    return;
  }
  if (targetId === existing.creatorId) {
    res.status(400).json({ error: "The creator already manages this squad." });
    return;
  }
  const memberIds = (existing.memberIds ?? []) as string[];
  if (!memberIds.includes(targetId)) {
    res.status(400).json({ error: "Only squad members can be made co-admins." });
    return;
  }
  const current = (existing.coAdminIds ?? []) as string[];
  if (current.includes(targetId)) {
    res.json(existing);
    return;
  }
  // Atomic, dedupe-safe append so concurrent grants can't duplicate or lose entries.
  const [squad] = await db
    .update(squadsTable)
    .set({
      coAdminIds: sql`CASE WHEN ${squadsTable.coAdminIds} @> ${JSON.stringify([targetId])}::jsonb THEN ${squadsTable.coAdminIds} ELSE ${squadsTable.coAdminIds} || ${JSON.stringify([targetId])}::jsonb END`,
      version: sql`${squadsTable.version} + 1`,
    })
    .where(eq(squadsTable.id, id))
    .returning();
  res.json(squad);
  emitSquadUpdate(id);

  void (async () => {
    try {
      const tokens = await storage.getPushTokensForUsers([targetId]);
      if (tokens.length === 0) return;
      await sendPushNotifications(
        tokens,
        {
          title: squad.name,
          body: `You're now a co-admin of "${squad.name}" — you can help manage it.`,
          data: { screen: "squad", squadId: squad.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
    } catch (err) {
      logger.error({ err }, "Error sending squad co-admin-added push notification");
    }
  })();
});

// Revoke a co-admin. Creator-only.
router.delete("/squads/:id/co-admins/:userId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const targetId = parseId(req.params.userId);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (existing.creatorId !== userId) {
    res.status(403).json({ error: "Only the squad creator can change co-admins." });
    return;
  }
  const current = (existing.coAdminIds ?? []) as string[];
  if (!current.includes(targetId)) {
    res.json(existing);
    return;
  }
  // Atomic removal so concurrent revocations can't lose updates (no read-modify-write).
  const [squad] = await db
    .update(squadsTable)
    .set({
      coAdminIds: sql`COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text(${squadsTable.coAdminIds}) AS elem WHERE elem <> ${targetId}), '[]'::jsonb)`,
      version: sql`${squadsTable.version} + 1`,
    })
    .where(eq(squadsTable.id, id))
    .returning();
  res.json(squad);
  emitSquadUpdate(id);
});

export default router;
