import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  reportsTable,
  userBlocksTable,
  feedPostsTable,
  momentsTable,
  photosTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendEmail } from "../services/email";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const ADMIN_EMAIL = process.env.REPORTS_EMAIL ?? process.env.SENDGRID_FROM;

// ── Reports ───────────────────────────────────────────────────────────────────

const CreateReportBody = z.object({
  contentType: z.enum(["post", "moment", "message", "photo", "profile"]),
  contentId: z.string().min(1),
  targetUserId: z.string().min(1),
  reason: z.enum(["spam", "inappropriate_content", "harassment", "other"]),
  notes: z.string().max(500).optional(),
});

const AUTO_HIDE_THRESHOLD = 3;
type ReportContentType = "post" | "moment" | "message" | "photo" | "profile";

/**
 * Applies auto-hide to a piece of content when it reaches the report threshold.
 * Only operates on content types that have a status column.
 */
async function maybeAutoHide(contentType: ReportContentType, contentId: string): Promise<void> {
  if (contentType !== "post" && contentType !== "moment" && contentType !== "photo") return;

  const rows = await db
    .select({ reporterId: reportsTable.reporterId })
    .from(reportsTable)
    .where(
      and(eq(reportsTable.contentType, contentType), eq(reportsTable.contentId, contentId)),
    );
  const count = new Set(rows.map((r) => r.reporterId)).size;
  if (count < AUTO_HIDE_THRESHOLD) return;

  if (contentType === "post") {
    await db
      .update(feedPostsTable)
      .set({ status: "hidden" })
      .where(eq(feedPostsTable.id, contentId));
  } else if (contentType === "moment") {
    await db
      .update(momentsTable)
      .set({ status: "hidden" })
      .where(eq(momentsTable.id, contentId));
  } else if (contentType === "photo") {
    const numId = Number(contentId);
    if (!Number.isNaN(numId)) {
      await db
        .update(photosTable)
        .set({ status: "hidden" })
        .where(eq(photosTable.id, numId));
    }
  }
}

/**
 * POST /api/reports
 * Submit a content report. Idempotent — a second report for the same
 * (reporter, contentType, contentId) tuple is silently accepted.
 * After reaching AUTO_HIDE_THRESHOLD distinct reporters the content is
 * automatically hidden; an admin email is sent on every new report.
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
    const [inserted] = await db
      .insert(reportsTable)
      .values({
        reporterId: userId,
        contentType,
        contentId,
        targetUserId,
        reason,
        notes: notes ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: reportsTable.id });

    if (inserted) {
      // Auto-hide content that has reached the threshold, then notify admin.
      maybeAutoHide(contentType, contentId).catch((err) =>
        logger.error({ err }, "[moderation] Auto-hide failed"),
      );

      if (ADMIN_EMAIL) {
        sendEmail({
          to: ADMIN_EMAIL,
          from: ADMIN_EMAIL,
          subject: `[Squadz Report] ${contentType} — ${reason}`,
          text: [
            `A new content report was submitted.`,
            ``,
            `Reporter: ${userId}`,
            `Target user: ${targetUserId}`,
            `Content type: ${contentType}`,
            `Content ID: ${contentId}`,
            `Reason: ${reason}`,
            notes ? `Notes: ${notes}` : "",
          ]
            .filter((l) => l !== undefined)
            .join("\n"),
          html: `<p>A new content report was submitted.</p>
<ul>
<li><strong>Reporter:</strong> ${userId}</li>
<li><strong>Target user:</strong> ${targetUserId}</li>
<li><strong>Content type:</strong> ${contentType}</li>
<li><strong>Content ID:</strong> ${contentId}</li>
<li><strong>Reason:</strong> ${reason}</li>
${notes ? `<li><strong>Notes:</strong> ${notes}</li>` : ""}
</ul>`,
        }).catch((err) => logger.error({ err }, "[moderation] Failed to send report email"));
      }
    }

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
      const rows = await db
        .select()
        .from(userBlocksTable)
        .where(
          and(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, targetId)),
        );
      res.json({ blocked: rows.length > 0 });
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
