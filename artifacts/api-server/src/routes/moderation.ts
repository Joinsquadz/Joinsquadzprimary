import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, reportsTable, userBlocksTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

// ── Reports ───────────────────────────────────────────────────────────────────

const CreateReportBody = z.object({
  contentType: z.enum(["post", "moment", "message"]),
  contentId: z.string().min(1),
  targetUserId: z.string().min(1),
  reason: z.enum(["spam", "inappropriate", "harassment", "other"]),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/reports
 * Submit a content report. Idempotent — a second report for the same
 * (reporter, contentType, contentId) tuple is silently accepted.
 * Reports are stored for admin review; no moderation action is automatic.
 */
router.post("/reports", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid fields" });
    return;
  }
  const userId = req.user!.id;
  const { contentType, contentId, targetUserId, reason, notes } = parsed.data;

  if (targetUserId === userId) {
    res.status(400).json({ error: "Cannot report yourself" });
    return;
  }

  try {
    await db
      .insert(reportsTable)
      .values({
        reporterId: userId,
        contentType,
        contentId,
        targetUserId,
        reason,
        notes: notes ?? null,
      })
      .onConflictDoNothing();

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[moderation] Failed to insert report");
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// ── Blocks ────────────────────────────────────────────────────────────────────

/**
 * GET /api/users/blocks
 * Returns the list of user IDs the caller has blocked.
 */
router.get("/users/blocks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  try {
    const rows = await db
      .select({ blockedId: userBlocksTable.blockedId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockerId, userId));
    res.json({ blockedIds: rows.map((r) => r.blockedId) });
  } catch (err) {
    logger.error({ err }, "[moderation] Failed to list blocks");
    res.status(500).json({ error: "Failed to list blocks" });
  }
});

/**
 * POST /api/users/:id/block
 * Block a user. Idempotent.
 */
router.post(
  "/users/:id/block",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const targetId = parseId(req.params.id);

    if (targetId === userId) {
      res.status(400).json({ error: "Cannot block yourself" });
      return;
    }

    try {
      await db
        .insert(userBlocksTable)
        .values({ blockerId: userId, blockedId: targetId })
        .onConflictDoNothing();
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "[moderation] Failed to insert block");
      res.status(500).json({ error: "Failed to block user" });
    }
  },
);

/**
 * DELETE /api/users/:id/block
 * Unblock a user.
 */
router.delete(
  "/users/:id/block",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const targetId = parseId(req.params.id);
    try {
      await db
        .delete(userBlocksTable)
        .where(
          and(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, targetId)),
        );
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "[moderation] Failed to delete block");
      res.status(500).json({ error: "Failed to unblock user" });
    }
  },
);

/**
 * GET /api/users/:id/block
 * Check whether the caller has blocked this user.
 */
router.get(
  "/users/:id/block",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const targetId = parseId(req.params.id);
    try {
      const [row] = await db
        .select()
        .from(userBlocksTable)
        .where(
          and(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, targetId)),
        )
        .limit(1);
      res.json({ blocked: !!row });
    } catch (err) {
      logger.error({ err }, "[moderation] Failed to check block");
      res.status(500).json({ error: "Failed to check block" });
    }
  },
);

/**
 * Returns all user IDs that are in a block relationship with `userId`
 * (both directions). Used by feed / moments queries to suppress content
 * from blocked users in both directions.
 */
export async function getBlockedAndBlockerIds(userId: string): Promise<string[]> {
  const [blockedByUser, blockersOfUser] = await Promise.all([
    db
      .select({ id: userBlocksTable.blockedId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockerId, userId)),
    db
      .select({ id: userBlocksTable.blockerId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockedId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of blockedByUser) ids.add(r.id);
  for (const r of blockersOfUser) ids.add(r.id);
  return [...ids];
}

export default router;
