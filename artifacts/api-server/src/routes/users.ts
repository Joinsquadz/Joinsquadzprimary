import { Router, type IRouter, type Request, type Response } from "express";
import { inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/users/batch", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = typeof req.query.ids === "string" ? req.query.ids : "";
    const ids = raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);

    if (ids.length === 0) {
      res.json([]);
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
      .where(inArray(usersTable.id, ids));

    res.json(users);
  } catch (err) {
    logger.error({ err }, "Error fetching user batch");
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

export default router;
