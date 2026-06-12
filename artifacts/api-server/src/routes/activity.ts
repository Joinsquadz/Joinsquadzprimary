import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gt, desc } from "drizzle-orm";
import { db, activityTable, usersTable, type DbActivity } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { onActivityUpdate } from "../lib/activityEvents";

const router: IRouter = Router();

// How many of the recipient's most-recent rows we group/paginate over. The
// client paginates 30 at a time on top of this; the cap bounds memory for very
// active users while still covering far more than anyone scrolls.
const WORKING_SET = 500;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

// Reactions and RSVPs are grouped by content item; everything else is shown
// as its own row.
const GROUPED_TYPES = new Set(["vibe_reaction", "vault_reaction", "rsvp"]);

type ActivityItem = {
  /** Stable id: `${type}:${subjectId}` for groups, the row id for singles. */
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  grouped: boolean;
  /** Unique actor ids, most-recent first (full list for the group bottom sheet). */
  actorIds: string[];
  actorCount: number;
  createdAt: string;
  read: boolean;
  meta: DbActivity["meta"];
};

function buildItems(rows: DbActivity[], lastReadMs: number): ActivityItem[] {
  const groups = new Map<string, ActivityItem>();
  const items: ActivityItem[] = [];

  for (const row of rows) {
    const createdMs = row.createdAt ? new Date(row.createdAt).getTime() : 0;
    const read = createdMs <= lastReadMs;
    if (GROUPED_TYPES.has(row.type) && row.subjectId) {
      const key = `${row.type}:${row.subjectId}`;
      const existing = groups.get(key);
      if (existing) {
        if (!existing.actorIds.includes(row.actorId)) {
          existing.actorIds.push(row.actorId);
          existing.actorCount += 1;
        }
        // rows are desc by createdAt, so the first row seen is the latest:
        // keep that createdAt/meta/read and only extend the actor list.
        continue;
      }
      const item: ActivityItem = {
        id: key,
        type: row.type,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        grouped: true,
        actorIds: [row.actorId],
        actorCount: 1,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
        read,
        meta: row.meta,
      };
      groups.set(key, item);
      items.push(item);
    } else {
      items.push({
        id: row.id,
        type: row.type,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        grouped: false,
        actorIds: [row.actorId],
        actorCount: 1,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date(0).toISOString(),
        read,
        meta: row.meta,
      });
    }
  }

  // rows arrived desc by createdAt, so items are already in latest-first order
  // (grouped items keep the position of their newest row). No re-sort needed.
  return items;
}

// GET /api/activity?page=&limit= — paginated, grouped, reverse-chronological.
// Only ever returns activity addressed to the authenticated user.
router.get("/activity", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const page = Math.max(0, Number(req.query.page) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_LIMIT));

    const [user] = await db
      .select({ activityLastReadAt: usersTable.activityLastReadAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const lastReadMs = user?.activityLastReadAt ? new Date(user.activityLastReadAt).getTime() : 0;

    const rows = await db
      .select()
      .from(activityTable)
      .where(eq(activityTable.recipientId, userId))
      .orderBy(desc(activityTable.createdAt))
      .limit(WORKING_SET);

    const allItems = buildItems(rows, lastReadMs);
    const start = page * limit;
    const items = allItems.slice(start, start + limit);
    const hasMore = start + limit < allItems.length;

    res.json({ items, hasMore, page, limit });
  } catch (err) {
    logger.error({ err }, "Error fetching activity");
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// GET /api/activity/unread-count — { count } of items newer than last read.
router.get("/activity/unread-count", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const [user] = await db
      .select({ activityLastReadAt: usersTable.activityLastReadAt })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    const lastRead = user?.activityLastReadAt ?? null;

    const conditions = [eq(activityTable.recipientId, userId)];
    if (lastRead) conditions.push(gt(activityTable.createdAt, lastRead));

    const rows = await db
      .select({ id: activityTable.id })
      .from(activityTable)
      .where(and(...conditions))
      .limit(100);

    const count = rows.length >= 100 ? 99 : rows.length;
    res.json({ count });
  } catch (err) {
    logger.error({ err }, "Error fetching unread activity count");
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// POST /api/activity/read — mark everything read (bumps last-read timestamp).
router.post("/activity/read", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    await db
      .update(usersTable)
      .set({ activityLastReadAt: new Date() })
      .where(eq(usersTable.id, userId));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error marking activity read");
    res.status(500).json({ error: "Failed to mark activity read" });
  }
});

// GET /api/activity/stream — SSE; emits "update" whenever a new activity row is
// recorded for this user, so the badge and (if open) the feed can refresh.
router.get("/activity/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = onActivityUpdate(userId, () => {
    res.write(`event: update\ndata: {}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
