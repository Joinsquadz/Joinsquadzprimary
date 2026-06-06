import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, squadsTable } from "@workspace/db";

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

const SEED_SQUADS = [
  { id: "s1", name: "The Usual Suspects", emoji: "🔥", color: "#FF5C3A", memberIds: ["me", "u1", "u2", "u3", "u4", "u5"] },
  { id: "s2", name: "College Squad", emoji: "🎓", color: "#4A9EFF", memberIds: ["me", "u2", "u3"] },
  { id: "s3", name: "Work Crew", emoji: "💼", color: "#2ECC8A", memberIds: ["me", "u1", "u4"] },
];

let seeded = false;

async function seedIfEmpty() {
  if (seeded) return;
  const existing = await db.select().from(squadsTable).limit(1);
  if (existing.length === 0) {
    await db.insert(squadsTable).values(SEED_SQUADS).onConflictDoNothing();
  }
  seeded = true;
}

router.get("/squads", async (req: Request, res: Response): Promise<void> => {
  await seedIfEmpty();
  const squads = await db.select().from(squadsTable).orderBy(squadsTable.createdAt);
  res.json(squads);
});

router.post("/squads", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSquadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [squad] = await db.insert(squadsTable).values(parsed.data).returning();
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
