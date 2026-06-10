import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, inArray, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  momentsTable,
  momentViewsTable,
  momentReactionsTable,
  friendshipsTable,
  squadsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitFeedUpdate } from "../lib/feedEvents";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const MOMENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VIDEO_MS = 60 * 1000;

async function getFriendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ friendId: friendshipsTable.friendId })
    .from(friendshipsTable)
    .where(eq(friendshipsTable.ownerId, userId));
  return rows.map((r) => r.friendId);
}

/** Live (non-expired, non-deleted) condition reused by every read. */
function liveCondition() {
  return and(isNull(momentsTable.deletedAt), gt(momentsTable.expiresAt, new Date()));
}

/**
 * Whether a user is in a moment's audience. The author always can; a friends
 * moment is visible to the author's friends; a squad moment is visible to
 * current members of that squad. Prevents out-of-audience interaction (views,
 * reactions) by ID guessing (IDOR) and the author-side signal leakage it causes.
 */
async function canViewMoment(userId: string, moment: MomentRow): Promise<boolean> {
  if (moment.authorId === userId) return true;
  if (moment.audience === "friends") {
    const friendIds = await getFriendIds(userId);
    return friendIds.includes(moment.authorId);
  }
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, moment.audience));
  return !!squad && ((squad.memberIds ?? []) as string[]).includes(userId);
}

const CreateMomentBody = z.object({
  audience: z.string().min(1), // "friends" | squadId
  mediaUrl: z.string().min(1),
  mediaType: z.enum(["photo", "video"]),
  durationMs: z.number().int().positive().optional(),
});

// POST /api/moments — post a 24h moment to friends or a squad.
router.post("/moments", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = CreateMomentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { audience, mediaUrl, mediaType, durationMs } = parsed.data;

    if (mediaType === "video" && durationMs && durationMs > MAX_VIDEO_MS) {
      res.status(400).json({ error: "Video moments must be 60 seconds or shorter." });
      return;
    }

    // Provenance: only attach media you uploaded. The moment-media ACL always
    // authorizes the author, so without this a user could point a moment at
    // someone else's private object path and self-authorize access to it.
    // Public uploads (full https URLs) carry no private object path to forge.
    if (!/^https?:\/\//i.test(mediaUrl)) {
      const owner = await storage.getUploadOwner(mediaUrl);
      if (owner !== userId) {
        res.status(403).json({ error: "You can only attach media you uploaded." });
        return;
      }
    }

    let recipientIds: string[] = [];
    if (audience === "friends") {
      recipientIds = await getFriendIds(userId);
    } else {
      const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, audience));
      if (!squad || !((squad.memberIds ?? []) as string[]).includes(userId)) {
        res.status(403).json({ error: "You can only post moments to squads you belong to." });
        return;
      }
      recipientIds = ((squad.memberIds ?? []) as string[]).filter((id) => id !== userId);
    }

    const expiresAt = new Date(Date.now() + MOMENT_TTL_MS);
    const [moment] = await db
      .insert(momentsTable)
      .values({ authorId: userId, audience, mediaUrl, mediaType, durationMs: durationMs ?? null, expiresAt })
      .returning();

    res.status(201).json({ id: moment.id, expiresAt: moment.expiresAt });

    void (async () => {
      try {
        recipientIds.forEach((id) => emitFeedUpdate(id));
        emitFeedUpdate(userId);
        if (recipientIds.length === 0) return;
        const author = await storage.getUser(userId);
        const authorName = author?.firstName ?? "Someone";
        const targets =
          audience === "friends"
            ? recipientIds
            : await storage.filterUnmutedForSquad(recipientIds, audience);
        const tokens = await storage.getPushTokensForUsers(targets, {
          requireNotifyFriendActivity: true,
        });
        if (tokens.length > 0) {
          await sendPushNotifications(
            tokens,
            {
              title: authorName,
              body: "shared a new moment",
              data: { screen: "feed" },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        }
      } catch (err) {
        logger.error({ err }, "Error fanning out moment");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error creating moment");
    res.status(500).json({ error: "Failed to create moment" });
  }
});

type MomentRow = typeof momentsTable.$inferSelect;

/** Group live moments into per-author "rings" with seen/unseen state. */
async function buildRings(moments: MomentRow[], viewerId: string) {
  if (moments.length === 0) return [];
  const momentIds = moments.map((m) => m.id);
  const views = await db
    .select({ momentId: momentViewsTable.momentId })
    .from(momentViewsTable)
    .where(and(inArray(momentViewsTable.momentId, momentIds), eq(momentViewsTable.viewerId, viewerId)));
  const seenIds = new Set(views.map((v) => v.momentId));

  const byAuthor = new Map<string, MomentRow[]>();
  for (const m of moments) {
    const arr = byAuthor.get(m.authorId) ?? [];
    arr.push(m);
    byAuthor.set(m.authorId, arr);
  }

  return Array.from(byAuthor.entries()).map(([authorId, authorMoments]) => {
    const sorted = authorMoments.sort(
      (a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
    );
    const hasUnseen = sorted.some((m) => !seenIds.has(m.id));
    return {
      authorId,
      hasUnseen,
      isSelf: authorId === viewerId,
      moments: sorted.map((m) => ({
        id: m.id,
        mediaUrl: m.mediaUrl,
        mediaType: m.mediaType,
        durationMs: m.durationMs,
        createdAt: m.createdAt,
        expiresAt: m.expiresAt,
        seen: seenIds.has(m.id),
      })),
    };
  });
}

// GET /api/moments/friends — friends' (and own) live moments, grouped as rings.
router.get("/moments/friends", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const friendIds = await getFriendIds(userId);
    const authors = Array.from(new Set([userId, ...friendIds]));
    const moments = await db
      .select()
      .from(momentsTable)
      .where(
        and(
          liveCondition(),
          eq(momentsTable.audience, "friends"),
          inArray(momentsTable.authorId, authors),
        ),
      )
      .orderBy(desc(momentsTable.createdAt));
    const rings = await buildRings(moments, userId);
    // Self ring first, then unseen, then seen.
    rings.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return 0;
    });
    res.json({ rings });
  } catch (err) {
    logger.error({ err }, "Error fetching friends moments");
    res.status(500).json({ error: "Failed to fetch moments" });
  }
});

// GET /api/moments/squad/:squadId — live moments posted to a squad.
router.get(
  "/moments/squad/:squadId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const squadId = parseId(req.params.squadId);
      const userId = (req.user as { id: string }).id;
      const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, squadId));
      if (!squad || !((squad.memberIds ?? []) as string[]).includes(userId)) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      const moments = await db
        .select()
        .from(momentsTable)
        .where(and(liveCondition(), eq(momentsTable.audience, squadId)))
        .orderBy(desc(momentsTable.createdAt));
      const rings = await buildRings(moments, userId);
      rings.sort((a, b) => {
        if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
        if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
        return 0;
      });
      res.json({ rings });
    } catch (err) {
      logger.error({ err }, "Error fetching squad moments");
      res.status(500).json({ error: "Failed to fetch moments" });
    }
  },
);

// POST /api/moments/:id/views — mark a moment seen by the viewer.
router.post("/moments/:id/views", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const [moment] = await db.select().from(momentsTable).where(eq(momentsTable.id, id));
    if (!moment || moment.deletedAt) {
      res.status(404).json({ error: "Moment not found" });
      return;
    }
    if (!(await canViewMoment(userId, moment))) {
      res.status(403).json({ error: "You can't view this moment." });
      return;
    }
    await db
      .insert(momentViewsTable)
      .values({ momentId: id, viewerId: userId })
      .onConflictDoNothing();
    res.json({ ok: true });
    emitFeedUpdate(moment.authorId);
  } catch (err) {
    logger.error({ err }, "Error marking moment viewed");
    res.status(500).json({ error: "Failed to mark viewed" });
  }
});

// GET /api/moments/:id/viewers — list who viewed (poster only).
router.get(
  "/moments/:id/viewers",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const userId = (req.user as { id: string }).id;
      const [moment] = await db.select().from(momentsTable).where(eq(momentsTable.id, id));
      if (!moment) {
        res.status(404).json({ error: "Moment not found" });
        return;
      }
      if (moment.authorId !== userId) {
        res.status(403).json({ error: "Only the poster can see viewers." });
        return;
      }
      const [viewers, reactions] = await Promise.all([
        db
          .select({ viewerId: momentViewsTable.viewerId, viewedAt: momentViewsTable.viewedAt })
          .from(momentViewsTable)
          .where(eq(momentViewsTable.momentId, id))
          .orderBy(desc(momentViewsTable.viewedAt)),
        db
          .select({ userId: momentReactionsTable.userId, emoji: momentReactionsTable.emoji })
          .from(momentReactionsTable)
          .where(eq(momentReactionsTable.momentId, id)),
      ]);
      const reactionByUser = new Map(reactions.map((r) => [r.userId, r.emoji]));
      res.json({
        viewers: viewers.map((v) => ({
          userId: v.viewerId,
          viewedAt: v.viewedAt,
          reaction: reactionByUser.get(v.viewerId) ?? null,
        })),
        count: viewers.length,
      });
    } catch (err) {
      logger.error({ err }, "Error listing moment viewers");
      res.status(500).json({ error: "Failed to list viewers" });
    }
  },
);

const MomentReactionBody = z.object({ emoji: z.string().min(1).max(8) });

// POST /api/moments/:id/reactions — react to a moment.
router.post(
  "/moments/:id/reactions",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      const userId = (req.user as { id: string }).id;
      const parsed = MomentReactionBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const [moment] = await db.select().from(momentsTable).where(eq(momentsTable.id, id));
      if (!moment || moment.deletedAt) {
        res.status(404).json({ error: "Moment not found" });
        return;
      }
      if (!(await canViewMoment(userId, moment))) {
        res.status(403).json({ error: "You can't react to this moment." });
        return;
      }
      await db
        .insert(momentReactionsTable)
        .values({ momentId: id, userId, emoji: parsed.data.emoji })
        .onConflictDoNothing();
      res.status(201).json({ ok: true });
      emitFeedUpdate(moment.authorId);

      if (moment.authorId !== userId) {
        void (async () => {
          try {
            const reactor = await storage.getUser(userId);
            const reactorName = reactor?.firstName ?? "Someone";
            const tokens = await storage.getPushTokensForUsers([moment.authorId], {
              requireNotifyFriendActivity: true,
            });
            if (tokens.length > 0) {
              await sendPushNotifications(
                tokens,
                {
                  title: reactorName,
                  body: `reacted ${parsed.data.emoji} to your moment`,
                  data: { screen: "feed" },
                },
                { onStaleToken: (token) => storage.clearPushToken(token) },
              );
            }
          } catch (err) {
            logger.error({ err }, "Error notifying moment reaction");
          }
        })();
      }
    } catch (err) {
      logger.error({ err }, "Error reacting to moment");
      res.status(500).json({ error: "Failed to react" });
    }
  },
);

// DELETE /api/moments/:id — delete your own moment.
router.delete("/moments/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const [moment] = await db.select().from(momentsTable).where(eq(momentsTable.id, id));
    if (!moment || moment.deletedAt) {
      res.status(404).json({ error: "Moment not found" });
      return;
    }
    if (moment.authorId !== userId) {
      res.status(403).json({ error: "You can only delete your own moments." });
      return;
    }
    await db.update(momentsTable).set({ deletedAt: new Date() }).where(eq(momentsTable.id, id));
    res.json({ ok: true });
    emitFeedUpdate(userId);
  } catch (err) {
    logger.error({ err }, "Error deleting moment");
    res.status(500).json({ error: "Failed to delete moment" });
  }
});

export default router;
