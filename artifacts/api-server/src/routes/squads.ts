import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql, inArray, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db, squadsTable, usersTable, squadMutesTable, squadRemovalNoticesTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";

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

  // Atomic append: the WHERE NOT @> guard ensures that even under concurrent
  // joins, no member is silently overwritten. If the user is already a member
  // this UPDATE matches 0 rows and returns an empty array.
  const [updated] = await db
    .update(squadsTable)
    .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb` })
    .where(
      and(
        eq(squadsTable.id, id),
        sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
      ),
    )
    .returning();

  if (!updated) {
    res.json({ squad, alreadyMember: true });
    return;
  }
  res.status(201).json({ squad: updated, alreadyMember: false });

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

  // Atomic append: the WHERE NOT @> guard prevents the classic concurrent
  // read-modify-write race where two simultaneous joins each overwrite the
  // other's append. 0 rows returned means the user was already a member.
  const [updated] = await db
    .update(squadsTable)
    .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([userId])}::jsonb` })
    .where(
      and(
        eq(squadsTable.id, squad.id),
        sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
      ),
    )
    .returning();

  if (!updated) {
    res.json({ squad, alreadyMember: true });
    return;
  }
  res.status(201).json({ squad: updated, alreadyMember: false });

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
  const memberIds = Array.from(new Set([userId, ...parsed.data.memberIds]));
  const inviteCode = generateInviteCode();
  const [squad] = await db.insert(squadsTable).values({ ...parsed.data, memberIds, creatorId: userId, inviteCode }).returning();
  res.status(201).json(squad);

  // Fire-and-forget: notify added members (not the creator) that they're in a new squad,
  // skipping anyone who has muted notifications for this squad.
  const addedMembers = memberIds.filter((id) => id !== userId);
  if (addedMembers.length > 0) {
    (async () => {
      try {
        const unmuted = await storage.filterUnmutedForSquad(addedMembers, squad.id);
        if (unmuted.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifySquadJoin: true });
        await sendPushNotifications(
          tokens,
          {
            title: "You've been added to a squad",
            body: `You're now in "${squad.name}"`,
            data: { screen: "squad", squadId: squad.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad-added push notifications");
      }
    })();
  }
});

router.get("/squads/muted", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const squads = await storage.getMutedSquadsForUser(userId);
  res.json({ squads });
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
  res.json({ ...squad, members });
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

  // Only the squad creator can change invite permissions.
  if (parsed.data.membersCanInvite !== undefined && existing.creatorId !== userId) {
    res.status(403).json({ error: "Only the squad creator can change invite permissions." });
    return;
  }

  // Detect newly added members before applying the update.
  const addedMemberIds = parsed.data.memberIds
    ? parsed.data.memberIds.filter((id) => !memberIds.includes(id))
    : [];

  const { version: clientVersion, ...fieldsToUpdate } = parsed.data;
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
  res.json(squad);

  // Fire-and-forget: notify members when new members are added.
  if (addedMemberIds.length > 0) {
    const recipientIds = memberIds.filter((id) => id !== userId);
    (async () => {
      try {
        const adder = await storage.getUser(userId);
        const adderName = adder?.firstName
          ? adder.lastName
            ? `${adder.firstName} ${adder.lastName}`
            : adder.firstName
          : "Someone";

        // Notify existing members (not the actor) that a new member was added.
        if (recipientIds.length > 0) {
          const existingTokens = await storage.getPushTokensForUsers(recipientIds);
          await sendPushNotifications(
            existingTokens,
            {
              title: squad.name,
              body: `${adderName} added a new member to "${squad.name}"`,
              data: { screen: "squad", squadId: squad.id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        }

        // Notify each newly added member that they were added by the actor.
        const newMemberTokens = await storage.getPushTokensForUsers(addedMemberIds, { requireNotifySquadJoin: true });
        await sendPushNotifications(
          newMemberTokens,
          {
            title: "You were added to a squad",
            body: `${adderName} added you to "${squad.name}"`,
            data: { screen: "squad", squadId: squad.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending squad member-added push notifications");
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
  // Wrap both deletions in a transaction so a mid-flight crash never leaves
  // orphaned squad_mutes rows: either both succeed or neither does.
  await db.transaction(async (tx) => {
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
    const photos = await storage.getSquadVaultPhotos(id);
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

  // Atomic append: the WHERE NOT @> guard prevents the concurrent race where
  // two callers both read the same memberIds and each overwrite the other's
  // write. 0 rows returned means the target was already a member.
  const [updated] = await db
    .update(squadsTable)
    .set({ memberIds: sql`${squadsTable.memberIds} || ${JSON.stringify([target.id])}::jsonb` })
    .where(
      and(
        eq(squadsTable.id, id),
        sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([target.id])}::jsonb)`,
      ),
    )
    .returning();

  if (!updated) {
    res.status(409).json({ error: "That user is already in the squad." });
    return;
  }
  res.status(201).json({ squad: updated, addedUser: target });

  // Fire-and-forget: notify the newly added user that they were added to this squad,
  // unless they have muted notifications for this squad.
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
          title: "You were added to a squad",
          body: `${adderName} added you to "${squad.name}"`,
          data: { screen: "squad", squadId: squad.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
    } catch (err) {
      logger.error({ err }, "Error sending member-added push notification");
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
  const isSelf = requesterId === targetUserId;
  if (!isCreator && !isSelf) {
    res.status(403).json({ error: "Only the squad creator or the member themselves can remove a member." });
    return;
  }
  if (!memberIds.includes(targetUserId)) {
    res.status(404).json({ error: "User is not in this squad." });
    return;
  }
  if (isCreator && targetUserId === squad.creatorId && !isSelf) {
    res.status(400).json({ error: "The creator cannot be removed. Transfer ownership or delete the squad instead." });
    return;
  }
  const updatedMemberIds = memberIds.filter((uid) => uid !== targetUserId);
  const [updatedSquad] = await db
    .update(squadsTable)
    .set({ memberIds: updatedMemberIds })
    .where(eq(squadsTable.id, id))
    .returning();

  // Clean up any stale mute row for the removed user so orphaned rows
  // don't accumulate and don't cause confusion on re-join.
  await db
    .delete(squadMutesTable)
    .where(and(eq(squadMutesTable.userId, targetUserId), eq(squadMutesTable.squadId, id)));

  res.json(updatedSquad);

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
  if (existing.creatorId !== userId) {
    res.status(403).json({ error: "Only the squad creator can regenerate the invite link." });
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

router.post("/squads/:id/join", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  if (!squad.isPublic) {
    res.status(403).json({ error: "This squad is not open to new members." });
    return;
  }
  const memberIds = (squad.memberIds ?? []) as string[];
  if (memberIds.includes(userId)) {
    res.json(squad);
    return;
  }
  const [updated] = await db
    .update(squadsTable)
    .set({ memberIds: [...memberIds, userId] })
    .where(eq(squadsTable.id, id))
    .returning();
  res.json(updated);

  // Fire-and-forget: welcome the joiner.
  (async () => {
    try {
      const [joinerToken] = await storage.getPushTokensForUsers([userId]);
      if (joinerToken) {
        await sendPushNotifications(
          [joinerToken],
          {
            title: `Welcome to ${squad.name}!`,
            body: `You're now a member of ${squad.name}.`,
            data: { screen: "squad", squadId: squad.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending welcome push to squad joiner");
    }
  })();

  // Fire-and-forget: notify existing members that someone new joined.
  // getPushTokensForUsers with requireNotifySquadJoin handles both the opt-out
  // preference check and returns an empty list when no one wants the notification.
  if (memberIds.length > 0) {
    (async () => {
      try {
        const joiner = await storage.getUser(userId);
        const joinerName = joiner?.firstName ?? "Someone";
        const tokens = await storage.getPushTokensForUsers(memberIds, { requireNotifySquadJoin: true });
        if (tokens.length === 0) return;
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
        logger.error({ err }, "Error sending squad-join push notifications");
      }
    })();
  }
});

export default router;
