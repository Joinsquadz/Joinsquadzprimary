import { Router, type IRouter } from "express";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";

const router: IRouter = Router();

const MAX_IDS = 100;

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

export default router;
