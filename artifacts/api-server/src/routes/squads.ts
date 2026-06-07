import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, squadsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";

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
  emoji: z.string().default("👥"),
  color: z.string().default("#FF5C3A"),
  memberIds: z.array(z.string()).default([]),
  isPublic: z.boolean().default(false),
});

const UpdateSquadBody = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
  isPublic: z.boolean().optional(),
});

router.get("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const squads = await db
    .select()
    .from(squadsTable)
    .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`)
    .orderBy(squadsTable.createdAt);
  res.json(squads);
});

router.post("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req.user as { id: string }).id;
  const memberIds = Array.from(new Set([userId, ...parsed.data.memberIds]));
  const [squad] = await db.insert(squadsTable).values({ ...parsed.data, memberIds }).returning();
  res.status(201).json(squad);

  // Fire-and-forget: notify added members (not the creator) that they're in a new squad.
  const addedMembers = memberIds.filter((id) => id !== userId);
  if (addedMembers.length > 0) {
    (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers(addedMembers);
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
  res.json(squad);
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
  const [squad] = await db.update(squadsTable).set(parsed.data).where(eq(squadsTable.id, id)).returning();
  res.json(squad);
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
  await db.delete(squadsTable).where(eq(squadsTable.id, id));
  res.sendStatus(204);
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

router.post("/squads/:id/members", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "friendCode is required." });
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
  const [updated] = await db
    .update(squadsTable)
    .set({ memberIds: [...memberIds, target.id] })
    .where(eq(squadsTable.id, id))
    .returning();
  res.status(201).json({ squad: updated, addedUser: target });
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

  // Fire-and-forget: notify existing members that someone new joined.
  if (memberIds.length > 0) {
    (async () => {
      try {
        const joiner = await storage.getUser(userId);
        const joinerName = joiner?.firstName ?? "Someone";
        const tokens = await storage.getPushTokensForUsers(memberIds);
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
