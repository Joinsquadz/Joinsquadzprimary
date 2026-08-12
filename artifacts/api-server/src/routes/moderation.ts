import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, or, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  reportsTable,
  userBlocksTable,
  feedPostsTable,
  momentsTable,
  photosTable,
  conversationMessagesTable,
  usersTable,
  planIdeasTable,
  friendshipsTable,
  friendRequestsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendEmail } from "../services/email";
import { storage } from "../storage";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const ADMIN_EMAIL = process.env.REPORTS_EMAIL ?? process.env.SENDGRID_FROM;

// ── Reports ───────────────────────────────────────────────────────────────────

const CreateReportBody = z.object({
  contentType: z.enum(["post", "moment", "message", "photo", "profile", "idea"]),
  contentId: z.string().min(1),
  targetUserId: z.string().min(1),
  reason: z.enum(["spam", "inappropriate_content", "harassment", "other"]),
  notes: z.string().max(500).optional(),
});

const AUTO_HIDE_THRESHOLD = 3;
type ReportContentType = "post" | "moment" | "message" | "photo" | "profile" | "idea";

/**
 * Applies auto-hide to a piece of content when it reaches the 3-distinct-reporter
 * threshold. BUG-02: extended to cover "message" and "profile" in addition to
 * the original "post", "moment", "photo" content types.
 */
async function maybeAutoHide(contentType: ReportContentType, contentId: string): Promise<void> {
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
  } else if (contentType === "message") {
    // BUG-02: hide DM/chat messages from all participants' views.
    await db
      .update(conversationMessagesTable)
      .set({ status: "hidden" } as Record<string, unknown>)
      .where(eq(conversationMessagesTable.id, contentId));
  } else if (contentType === "profile") {
    // BUG-02: flag the user profile for moderation review. The user's content
    // remains in place but their profile endpoint returns a "under review" state.
    await db
      .update(usersTable)
      .set({ moderationHidden: true } as Record<string, unknown>)
      .where(eq(usersTable.id, contentId));
  } else if (contentType === "idea") {
    // Plan ideas: hidden status removes the idea from lists AND the merged
    // itinerary view (hidden ideas 404 on every per-id route).
    await db
      .update(planIdeasTable)
      .set({ status: "hidden" })
      .where(eq(planIdeasTable.id, contentId));
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

  // SEC-01: verify the reporter can currently see the content they are reporting.
  // Without this check, 3 coordinated accounts who know a UUID could auto-hide
  // content they have never legitimately viewed.
  const canView = await storage.canUserViewReportedContent(contentType, contentId, userId);
  if (!canView) {
    res.status(403).json({ error: "Content not found or not visible to you" });
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
 * Returns the users the caller has blocked. `blockedIds` is kept for existing
 * clients; `blocked` carries the display fields the Settings → Blocked Users
 * screen needs so it doesn't have to fan out one profile fetch per row (and
 * profile fetches are themselves block-gated).
 */
router.get("/users/blocks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  try {
    const rows = await db
      .select({ blockedId: userBlocksTable.blockedId })
      .from(userBlocksTable)
      .where(eq(userBlocksTable.blockerId, userId));
    const blockedIds = rows.map((r) => r.blockedId);
    if (blockedIds.length === 0) {
      res.json({ blockedIds: [], blocked: [] });
      return;
    }
    const users = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, blockedIds));
    const byId = new Map(users.map((u) => [u.id, u]));
    const blocked = blockedIds.map((id) => {
      const u = byId.get(id);
      const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
      return {
        id,
        name: name || "SquadZ user",
        profileImageUrl: u?.profileImageUrl ?? null,
      };
    });
    res.json({ blockedIds, blocked });
  } catch (err) {
    logger.error({ err }, "[moderation] Failed to list blocks");
    res.status(500).json({ error: "Failed to list blocks" });
  }
});

/**
 * POST /api/users/:id/block
 * Block a user. Idempotent.
 *
 * Blocking severs the private relationship in both directions: the friendship
 * is removed (both symmetric rows) and any pending friend request between the
 * two is cancelled, so neither side is left with a live private channel or a
 * request they could still accept. Shared squad group chat is deliberately
 * untouched — a blocked person's messages still appear in a squad you both
 * belong to; the remedy there is leaving the squad.
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

      // Sever the friendship in both directions.
      await db
        .delete(friendshipsTable)
        .where(
          or(
            and(
              eq(friendshipsTable.ownerId, userId),
              eq(friendshipsTable.friendId, targetId),
            ),
            and(
              eq(friendshipsTable.ownerId, targetId),
              eq(friendshipsTable.friendId, userId),
            ),
          ),
        );

      // Cancel any pending request either way so it can't be accepted later.
      await db
        .update(friendRequestsTable)
        .set({ status: "declined" })
        .where(
          and(
            eq(friendRequestsTable.status, "pending"),
            or(
              and(
                eq(friendRequestsTable.fromUserId, userId),
                eq(friendRequestsTable.toUserId, targetId),
              ),
              and(
                eq(friendRequestsTable.fromUserId, targetId),
                eq(friendRequestsTable.toUserId, userId),
              ),
            ),
          ),
        );

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
 * Re-exported for existing callers (feed / moments queries suppress content
 * from blocked users in both directions). The implementation lives in
 * lib/blocks so discovery surfaces can use it without importing this router.
 */
export { getBlockedAndBlockerIds } from "../lib/blocks";

export default router;
