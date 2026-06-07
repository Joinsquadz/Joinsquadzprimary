import { Router, type IRouter, type Request, type Response } from "express";
import { eq, count, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, eventsTable, usersTable } from "@workspace/db";
import { storage } from "../storage";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const FREE_EVENT_LIMIT = 3;
const PHOTO_VAULT_DAYS = 30;

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `SQ-${out}`;
}

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const CreateEventBody = z.object({
  emoji: z.string().default("🎉"),
  title: z.string().min(1),
  date: z.string().default("TBD"),
  location: z.string().default("TBD"),
  squadId: z.string().default(""),
  squadName: z.string().default("Personal"),
  hostId: z.string().optional(),
  description: z.string().default(""),
  inviteCode: z.string().optional(),
  isPublic: z.boolean().default(false),
});

const UpdateEventBody = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  location: z.string().optional(),
  emoji: z.string().optional(),
  budget: z.number().optional(),
  isPublic: z.boolean().optional(),
});

const SetRsvpBody = z.object({
  userId: z.string().optional(),
  status: z.enum(["going", "maybe", "notgoing"]),
});

const AddTaskBody = z.object({
  title: z.string().min(1),
});

const PatchTaskBody = z.object({
  done: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
});

const AddCostBody = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  paidById: z.string(),
  shares: z.array(z.object({ userId: z.string(), amount: z.number() })),
});

const AddPollBody = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
});

const VotePollBody = z.object({
  userId: z.string().optional(),
  optionId: z.string(),
});

const SendMessageBody = z.object({
  senderId: z.string().optional(),
  text: z.string().min(1),
});

const JoinEventBody = z.object({
  inviteCode: z.string().min(1),
});

async function getEventAsMember(
  id: string,
  userId: string,
  res: Response,
): Promise<(typeof eventsTable.$inferSelect) | null> {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return null;
  }
  const rsvps = (event.rsvps ?? {}) as Record<string, string>;
  if (event.hostId !== userId && !(userId in rsvps)) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return event;
}

// GET /events/preview?code=<inviteCode> — public, read-only preview of an event
// for shareable invite deep-links so a friend can see what they're joining
// before they sign in. Only exposes non-sensitive fields (no chat, costs, or
// member PII). Mirrors the public-squad preview (GET /discover/squads/:id).
router.get("/events/preview", async (req: Request, res: Response): Promise<void> => {
  try {
    const rawCode = req.query.code;
    const code = (Array.isArray(rawCode) ? rawCode[0] : rawCode) as string | undefined;
    if (!code || typeof code !== "string" || !code.trim()) {
      res.status(404).json({ error: "This invite isn't available." });
      return;
    }

    const [event] = await db
      .select()
      .from(eventsTable)
      .where(eq(eventsTable.inviteCode, code.trim()));

    if (!event) {
      res.status(404).json({ error: "This invite isn't available." });
      return;
    }
    if (event.cancelled) {
      res.status(410).json({ error: "This event has been cancelled." });
      return;
    }

    let hostName: string | null = null;
    if (event.hostId) {
      const [host] = await db
        .select({
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
        })
        .from(usersTable)
        .where(eq(usersTable.id, event.hostId));
      hostName =
        [host?.firstName, host?.lastName].filter(Boolean).join(" ").trim() || null;
    }

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingCount = Object.values(rsvps).filter((s) => s === "going").length;

    res.json({
      emoji: event.emoji,
      title: event.title,
      hostName,
      date: event.date,
      location: event.location,
      goingCount,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching event preview");
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// GET /events/count — requires auth, returns user's event count vs free limit
router.get("/events/count", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const total = await storage.countUserEventsThisYear(userId);
    res.json({ count: total, limit: FREE_EVENT_LIMIT });
  } catch (err) {
    logger.error({ err }, "Error fetching event count");
    res.status(500).json({ error: "Failed to fetch event count" });
  }
});

router.get("/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const events = await db
    .select()
    .from(eventsTable)
    .where(
      or(
        eq(eventsTable.hostId, userId),
        sql`${eventsTable.rsvps} ? ${userId}`,
      ),
    )
    .orderBy(eventsTable.createdAt);
  res.json(events);
});

router.post("/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const authUser = req.user as { id: string; email?: string };

  try {
    let user = await storage.getUser(authUser.id);
    if (!user) {
      user = await storage.upsertUser(authUser.id, authUser.email ?? "");
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === "active" || sub?.status === "trialing";
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    if (!isPro) {
      const eventCount = await storage.countUserEventsThisYear(authUser.id);
      if (eventCount >= FREE_EVENT_LIMIT) {
        res.status(403).json({
          error: `Free plan is limited to ${FREE_EVENT_LIMIT} events. Upgrade to Pro to create unlimited events.`,
          requiresPro: true,
          count: eventCount,
          limit: FREE_EVENT_LIMIT,
        });
        return;
      }
    }
  } catch (err) {
    logger.error({ err }, "Error checking Pro status");
  }

  const { inviteCode, hostId: _bodyHostId, ...rest } = parsed.data;
  const hostId = authUser.id;

  const [event] = await db
    .insert(eventsTable)
    .values({ ...rest, hostId, inviteCode: inviteCode ?? randomCode() })
    .returning();
  res.status(201).json(event);
});

// POST /events/join — requires auth, joins an event by invite code
router.post("/events/join", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = (req.user as { id: string }).id;
  const { inviteCode } = parsed.data;

  const [existing] = await db
    .select()
    .from(eventsTable)
    .where(eq(eventsTable.inviteCode, inviteCode));

  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  if (existing.cancelled) {
    res.status(410).json({ error: "This event has been cancelled" });
    return;
  }

  const rsvps = (existing.rsvps ?? {}) as Record<string, string>;
  if (userId in rsvps) {
    res.status(409).json({ error: "You're already going to this event" });
    return;
  }

  const updatedRsvps = { ...rsvps, [userId]: "going" };
  const [event] = await db
    .update(eventsTable)
    .set({ rsvps: updatedRsvps })
    .where(eq(eventsTable.id, existing.id))
    .returning();

  res.json(event);
});

router.get("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const rsvps = (event.rsvps ?? {}) as Record<string, string>;
  const isHost = event.hostId === userId;
  const hasRsvp = userId in rsvps;
  if (!isHost && !hasRsvp) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  res.json(event);
});

router.patch("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = UpdateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (existing.hostId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.budget !== undefined) {
    patch.budget = String(parsed.data.budget);
  }
  const [event] = await db.update(eventsTable).set(patch).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.delete("/events/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  if (existing.hostId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  await db.delete(eventsTable).where(eq(eventsTable.id, id));
  res.sendStatus(204);
});

router.post("/events/:id/rsvp", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = SetRsvpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const rsvps = { ...(existing.rsvps as Record<string, string>), [userId]: parsed.data.status };
  const [event] = await db.update(eventsTable).set({ rsvps }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.post("/events/:id/tasks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const tasks = [
    ...(existing.tasks as unknown[]),
    { id: `t${Date.now()}`, title: parsed.data.title, assigneeId: null, done: false },
  ];
  const [event] = await db.update(eventsTable).set({ tasks }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.patch("/events/:id/tasks/:taskId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const taskId = parseId(req.params.taskId);
  const userId = (req.user as { id: string }).id;
  const parsed = PatchTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const tasks = (existing.tasks as Array<{ id: string; done: boolean; assigneeId: string | null; title: string }>).map(
    (t) => (t.id === taskId ? { ...t, ...parsed.data } : t),
  );
  const [event] = await db.update(eventsTable).set({ tasks }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.post("/events/:id/costs", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddCostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { amount, shares } = parsed.data;
  const hasInvalid = shares.some((s: { amount: number }) => s.amount < 0);
  const assigned = shares.reduce((sum: number, s: { amount: number }) => sum + s.amount, 0);
  if (amount <= 0 || hasInvalid || Math.abs(amount - assigned) >= 0.01) {
    res.status(400).json({ error: "Invalid cost: amount must be positive and shares must sum to total" });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const costs = [
    ...(existing.costs as unknown[]),
    { id: `c${Date.now()}`, ...parsed.data },
  ];
  const [event] = await db.update(eventsTable).set({ costs }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.post("/events/:id/polls", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = AddPollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const pollId = `p${Date.now()}`;
  const polls = [
    ...(existing.polls as unknown[]),
    {
      id: pollId,
      question: parsed.data.question,
      options: parsed.data.options.map((label: string, i: number) => ({ id: `po${Date.now()}${i}`, label, voterIds: [] })),
    },
  ];
  const [event] = await db.update(eventsTable).set({ polls }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.post("/events/:id/polls/:pollId/vote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const pollId = parseId(req.params.pollId);
  const userId = (req.user as { id: string }).id;
  const parsed = VotePollBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const { optionId } = parsed.data;
  const polls = (
    existing.polls as Array<{ id: string; question: string; options: Array<{ id: string; label: string; voterIds: string[] }> }>
  ).map((poll) =>
    poll.id !== pollId
      ? poll
      : {
          ...poll,
          options: poll.options.map((o) => ({
            ...o,
            voterIds:
              o.id === optionId
                ? Array.from(new Set([...o.voterIds, userId]))
                : o.voterIds.filter((v) => v !== userId),
          })),
        },
  );
  const [event] = await db.update(eventsTable).set({ polls }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.post("/events/:id/messages", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const parsed = SendMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const messages = [
    ...(existing.messages as unknown[]),
    { id: `m${Date.now()}`, senderId: userId, text: parsed.data.text, time: "Just now" },
  ];
  const [event] = await db.update(eventsTable).set({ messages }).where(eq(eventsTable.id, id)).returning();
  res.json(event);
});

router.get('/events/:id/photos', requireAuth, async (req, res): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const eventId = parseId(req.params['id']);

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? '');
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === 'active' || sub?.status === 'trialing';
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    const event = await storage.getEvent(eventId);
    if (!event) {
      res.status(404).json({ error: 'Event not found' });
      return;
    }
    if (event.hostId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const photos = await storage.getPhotosByEventId(eventId);
    const cutoff = new Date(Date.now() - PHOTO_VAULT_DAYS * 24 * 60 * 60 * 1000);

    const result = photos.map(photo => {
      const isExpired = photo.uploadedAt < cutoff;
      const locked = !isPro && isExpired;
      return locked
        ? { id: photo.id, eventId: photo.eventId, uploadedAt: photo.uploadedAt, locked: true }
        : { ...photo, locked: false };
    });

    res.json({ photos: result, isPro });
  } catch (err) {
    logger.error({ err }, 'Error fetching event photos');
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

export default router;
