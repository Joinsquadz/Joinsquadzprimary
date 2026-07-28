import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, eventsTable, squadsTable, usersTable, friendshipsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

// Public-safe preview of a single squad, used by shareable deep-links so a
// friend can see what they're joining before they're a member. Only exposes
// non-sensitive metadata, and only for squads that are explicitly public.
router.get("/discover/squads/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseId(req.params.id);
    const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
    if (!squad || !squad.isPublic) {
      res.status(404).json({ error: "This squad isn't available to join." });
      return;
    }
    const memberIds = (squad.memberIds ?? []) as string[];
    res.json({
      id: squad.id,
      name: squad.name,
      emoji: squad.emoji,
      color: squad.color,
      memberCount: memberIds.length,
      isPublic: squad.isPublic,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching public squad preview");
    res.status(500).json({ error: "Failed to fetch squad" });
  }
});

router.get("/discover", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    // Friendships are stored bidirectionally; ownerId row gives all of this user's friends.
    const friendRows = await db
      .select({ friendId: friendshipsTable.friendId })
      .from(friendshipsTable)
      .where(eq(friendshipsTable.ownerId, userId));
    const friendIds = friendRows.map((r) => r.friendId);

    if (friendIds.length === 0) {
      res.json({ events: [], squads: [] });
      return;
    }

    // Public squads where at least one friend is a member (jsonb array overlap) and user is not
    const rawSquads = await db
      .select()
      .from(squadsTable)
      .where(
        and(
          eq(squadsTable.isPublic, true),
          sql`NOT (${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb)`,
          sql`${squadsTable.memberIds} ?| ${friendIds}::text[]`,
        ),
      )
      .orderBy(squadsTable.createdAt)
      .limit(20);

    // Public events: not cancelled, user isn't host, user hasn't RSVP'd "going"
    const allPublicEvents = await db
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
      .limit(50);

    // Keep only events where at least one friend has RSVP'd "going"
    const friendSet = new Set(friendIds);
    const events = allPublicEvents
      .filter((e) => {
        const rsvps = (e.rsvps ?? {}) as Record<string, string>;
        return Object.entries(rsvps).some(([uid, status]) => friendSet.has(uid) && status === "going");
      })
      .slice(0, 10);

    const creatorIds = Array.from(
      new Set(rawSquads.map((s) => s.creatorId).filter((id): id is string => !!id)),
    );
    const creators =
      creatorIds.length > 0
        ? await db
            .select({ id: usersTable.id, firstName: usersTable.firstName, lastName: usersTable.lastName })
            .from(usersTable)
            .where(inArray(usersTable.id, creatorIds))
        : [];
    const creatorNameById = new Map(
      creators.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null]),
    );
    const squads = rawSquads.map((s) => ({
      ...s,
      creatorName: s.creatorId ? (creatorNameById.get(s.creatorId) ?? null) : null,
    }));

    res.json({ events, squads });
  } catch (err) {
    logger.error({ err }, "Error fetching discover feed");
    res.status(500).json({ error: "Failed to fetch discover feed" });
  }
});

export default router;
