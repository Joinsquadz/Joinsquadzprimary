import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, squadsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const CreateSquadBody = z.object({
  name: z.string().min(1),
  emoji: z.string().default("👥"),
  color: z.string().default("#FF5C3A"),
  memberIds: z.array(z.string()).default([]),
});

const UpdateSquadBody = z.object({
  name: z.string().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
});

router.get("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const squads = await db
    .select()
    .from(squadsTable)
    .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`)
    .orderBy(squadsTable.createdAt);
  res.json(squads);
});

router.post("/squads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = (req.user as { id: string }).id;
  const memberIds = Array.from(new Set([userId, ...parsed.data.memberIds]));
  const [squad] = await db.insert(squadsTable).values({ ...parsed.data, memberIds }).returning();
  res.status(201).json(squad);
});

router.get("/squads/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const [squad] = await db.select().from(squadsTable).where(eq(squadsTable.id, id));
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  res.json(squad);
});

router.patch("/squads/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const parsed = UpdateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [squad] = await db.update(squadsTable).set(parsed.data).where(eq(squadsTable.id, id)).returning();
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  res.json(squad);
});

router.delete("/squads/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const [squad] = await db.delete(squadsTable).where(eq(squadsTable.id, id)).returning();
  if (!squad) {
    res.status(404).json({ error: "Squad not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
