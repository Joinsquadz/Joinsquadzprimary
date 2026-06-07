import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, eventsTable, squadsTable, usersTable } from "@workspace/db";
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

    const rawSquads = await db
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

    const creatorIds = Array.from(
      new Set(rawSquads.map((s) => s.creatorId).filter((id): id is string => !!id)),
    );
    const creators =
      creatorIds.length > 0
        ? await db
            .select({
              id: usersTable.id,
              firstName: usersTable.firstName,
              lastName: usersTable.lastName,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, creatorIds))
        : [];
    const creatorNameById = new Map(
      creators.map((c) => [
        c.id,
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null,
      ]),
    );

    const squads = rawSquads.map((s) => ({
      ...s,
      creatorName: s.creatorId ? creatorNameById.get(s.creatorId) ?? null : null,
    }));

    res.json({ events, squads });
  } catch (err) {
    logger.error({ err }, "Error fetching discover feed");
    res.status(500).json({ error: "Failed to fetch discover feed" });
  }
});

export default router;
