import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, eventsTable, squadsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/discover", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    const events = await db
      .select()
      .from(eventsTable)
      .where(
        and(
          eq(eventsTable.isPublic, true),
          ne(eventsTable.hostId, userId),
          sql`NOT (${eventsTable.rsvps} ? ${userId})`,
          eq(eventsTable.cancelled, false),
        ),
      )
      .orderBy(eventsTable.createdAt)
      .limit(20);

    const squads = await db
      .select()
      .from(squadsTable)
      .where(
        and(
          eq(squadsTable.isPublic, true),
          sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
        ),
      )
      .orderBy(squadsTable.createdAt)
      .limit(20);

    res.json({ events, squads });
  } catch (err) {
    logger.error({ err }, "Error fetching discover feed");
    res.status(500).json({ error: "Failed to fetch discover feed" });
  }
});

export default router;
