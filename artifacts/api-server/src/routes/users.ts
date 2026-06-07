import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MAX_IDS = 100;

router.get("/users/by-friend-code/:code", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const code = (req.params.code as string).toUpperCase().trim();
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(eq(usersTable.friendCode, code));
    if (!user) {
      res.status(404).json({ error: "No user found with that friend code." });
      return;
    }
    res.json(user);
  } catch (err) {
    logger.error({ err }, "Error looking up user by friend code");
    res.status(500).json({ error: "Failed to look up friend code" });
  }
});

router.get("/api/users", requireAuth, async (req, res) => {
  const rawIds = req.query.ids;
  if (!rawIds || typeof rawIds !== "string") {
    res.status(400).json({ error: "ids query param required (comma-separated)" });
    return;
  }

  const ids = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const parseResult = z.array(z.string().min(1)).safeParse(ids);
  if (!parseResult.success || ids.length === 0) {
    res.status(400).json({ error: "Invalid ids" });
    return;
  }

  const rows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));

  res.json(rows);
});

const SEARCH_LIMIT = 20;

router.get("/api/users/search", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q || q.length < 2) {
      res.status(400).json({ error: "q must be at least 2 characters" });
      return;
    }
    const currentUserId = (req.user as { id: string }).id;
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(
        sql`${usersTable.id} != ${currentUserId} AND (
          ${usersTable.firstName} ILIKE ${pattern} OR
          ${usersTable.lastName} ILIKE ${pattern} OR
          COALESCE(${usersTable.firstName}, '') || ' ' || COALESCE(${usersTable.lastName}, '') ILIKE ${pattern}
        )`
      )
      .limit(SEARCH_LIMIT);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Error searching users");
    res.status(500).json({ error: "Failed to search users" });
  }
});

export default router;
