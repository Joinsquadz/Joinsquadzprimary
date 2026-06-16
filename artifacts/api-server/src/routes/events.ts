import { Router, type IRouter, type Request, type Response } from "express";
import { eq, count, or, sql, and, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, eventsTable, eventCreationsTable, usersTable } from "@workspace/db";
import { storage } from "../storage";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitEventUpdate, onEventUpdate } from "../lib/eventUpdates";
import { recordActivitySafe, removeActivity } from "../lib/activity";

const router: IRouter = Router();

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return "Someone";
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email?.split("@")[0] ?? "Someone";
}

const RSVP_LABEL: Record<string, string> = {
  going: "is going",
  maybe: "might come",
  notgoing: "can't make it",
};

const FREE_EVENT_LIMIT = 5;
// Free users may create up to FREE_EVENT_LIMIT events within this trailing
// window. Enforced against the append-only event_creations ledger, so deleting
// an event does not free a slot until its ledger row ages out of the window.
const EVENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

type EventExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

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
  eventAt: z.string().datetime().optional(),
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
  eventAt: z.string().datetime().optional(),
  location: z.string().optional(),
  emoji: z.string().optional(),
  budget: z.number().optional(),
  isPublic: z.boolean().optional(),
  version: z.number().int().optional(),
});

const SetRsvpBody = z.object({
  userId: z.string().optional(),
  status: z.enum(["going", "maybe", "notgoing"]),
  version: z.number().int().optional(),
});

const AddTaskBody = z.object({
  title: z.string().min(1),
  version: z.number().int().optional(),
  category: z.string().optional(),
});

const PatchTaskBody = z.object({
  done: z.boolean().optional(),
  assigneeId: z.string().nullable().optional(),
  version: z.number().int().optional(),
});

const AddCostBody = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  paidById: z.string(),
  shares: z.array(z.object({ userId: z.string(), amount: z.number() })),
  version: z.number().int().optional(),
});

const AddPollBody = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)),
  version: z.number().int().optional(),
});

const VotePollBody = z.object({
  userId: z.string().optional(),
  optionId: z.string(),
  version: z.number().int().optional(),
});

const SendMessageBody = z.object({
  senderId: z.string().optional(),
  text: z.string().min(1),
  version: z.number().int().optional(),
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

// The set of user IDs legitimately allowed to appear in an event's costs:
// the squad's members (for squad events) plus the host and anyone who RSVP'd.
// Used to reject costs that reference arbitrary/external user IDs (which would
// otherwise spoof debts, mis-fire "you owe" pushes, or leak payment handles).
async function allowedParticipantIds(
  event: typeof eventsTable.$inferSelect,
): Promise<Set<string>> {
  const ids = new Set<string>([event.hostId]);
  for (const k of Object.keys((event.rsvps ?? {}) as Record<string, string>)) ids.add(k);
  if (event.squadId) {
    const squad = await storage.getSquad(event.squadId);
    if (squad) for (const m of squad.memberIds) ids.add(m);
  }
  return ids;
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
    const total = await storage.countUserEventCreationsInWindow(userId);
    res.json({ count: total, limit: FREE_EVENT_LIMIT });
  } catch (err) {
    logger.error({ err }, "Error fetching event count");
    res.status(500).json({ error: "Failed to fetch event count" });
  }
});

router.get("/events", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  // Hide events once their concrete time has fully passed: an event drops off at
  // midnight at the start of the FOLLOWING day, i.e. keep events whose eventAt is
  // >= the start of today. Events with no concrete time yet (eventAt IS NULL —
  // still being planned / "TBD") are always kept.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const events = await db
    .select()
    .from(eventsTable)
    .where(
      and(
        or(
          eq(eventsTable.hostId, userId),
          sql`${eventsTable.rsvps} ? ${userId}`,
        ),
        or(
          isNull(eventsTable.eventAt),
          gte(eventsTable.eventAt, startOfToday),
        ),
      ),
    )
    .orderBy(eventsTable.eventAt, eventsTable.createdAt);
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

    const { inviteCode, hostId: _bodyHostId, eventAt, ...rest } = parsed.data;
    const hostId = authUser.id;
    const insertValues = {
      ...rest,
      hostId,
      inviteCode: inviteCode ?? randomCode(),
      ...(eventAt ? { eventAt: new Date(eventAt) } : {}),
    };

    // Enforce the free-tier event cap and append the ledger row atomically. A
    // per-user advisory lock serializes a user's concurrent creates so the
    // count-then-insert cannot race past the limit (mirrors the squad cap). Pro
    // users skip the cap. Under unit-test mocks db.transaction is absent, so we
    // fall back to a direct, unenforced insert (the cap is covered elsewhere).
    const runCreate = async (
      executor: EventExecutor,
      inTransaction: boolean,
    ): Promise<
      | { ok: true; event: typeof eventsTable.$inferSelect }
      | { ok: false; count: number }
    > => {
      if (!isPro && inTransaction) {
        await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${hostId}))`);
        const windowStart = new Date(Date.now() - EVENT_WINDOW_MS);
        const [row] = await executor
          .select({ count: sql<number>`count(*)::int` })
          .from(eventCreationsTable)
          .where(
            and(
              eq(eventCreationsTable.userId, hostId),
              gte(eventCreationsTable.createdAt, windowStart),
            ),
          );
        const used = row?.count ?? 0;
        if (used >= FREE_EVENT_LIMIT) return { ok: false, count: used };
      }
      const [created] = await executor.insert(eventsTable).values(insertValues).returning();
      await executor
        .insert(eventCreationsTable)
        .values({ userId: hostId, eventId: created.id });
      return { ok: true, event: created };
    };

    const result =
      typeof db.transaction === "function"
        ? await db.transaction((tx) => runCreate(tx, true))
        : await runCreate(db, false);

    if (!result.ok) {
      res.status(403).json({
        error: `Free plan is limited to ${FREE_EVENT_LIMIT} events in a 12-month window. Upgrade to Pro to create unlimited events.`,
        requiresPro: true,
        count: result.count,
        limit: FREE_EVENT_LIMIT,
      });
      return;
    }

    const event = result.event;
    res.status(201).json(event);

    // Fire-and-forget: a squad event invites the rest of the squad.
    if (event.squadId) {
      void (async () => {
        try {
          const squad = await storage.getSquad(event.squadId);
          const memberIds = ((squad?.memberIds ?? []) as string[]).filter((m) => m !== hostId);
          if (memberIds.length === 0) return;
          // Respect both per-squad mute and the Event Invites preference.
          const unmuted = await storage.filterUnmutedForSquad(memberIds, event.squadId);
          const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
          if (tokens.length === 0) return;

          const host = await storage.getUser(hostId);
          await sendPushNotifications(
            tokens,
            {
              title: `${event.emoji} ${event.title}`,
              body: `${displayName(host)} invited you to an event`,
              data: { screen: "event", eventId: event.id },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending event-invite push notifications");
        }
      })();
    }
  } catch (err) {
    logger.error({ err }, "Error creating event");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to create event" });
    }
  }
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

  // Atomic per-user merge (see /events/:id/rsvp): write only this user's key so
  // concurrent invite-link joins can't clobber each other's RSVP.
  const [event] = await db
    .update(eventsTable)
    .set({
      rsvps: sql`COALESCE(${eventsTable.rsvps}, '{}'::jsonb) || ${JSON.stringify({ [userId]: "going" })}::jsonb`,
      version: sql`${eventsTable.version} + 1`,
    })
    .where(eq(eventsTable.id, existing.id))
    .returning();

  res.json(event);
  emitEventUpdate(existing.id);
  recordActivitySafe({
    recipientId: event.hostId,
    actorId: userId,
    type: "rsvp",
    subjectType: "event",
    subjectId: event.id,
    meta: { rsvpStatus: "going", subjectName: event.title, subjectEmoji: event.emoji },
    dedupe: true,
  });

  // Fire-and-forget: joining by invite code is an RSVP, so tell the host
  // someone is going (skip the self-host case).
  if (event.hostId !== userId) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([event.hostId], { requireNotifyFriendActivity: true });
        if (tokens.length === 0) return;
        const responder = await storage.getUser(userId);
        const label = RSVP_LABEL["going"] ?? "is going";
        await sendPushNotifications(
          tokens,
          {
            title: `${event.emoji} ${event.title}`,
            body: `${displayName(responder)} ${label}`,
            data: { screen: "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending join RSVP push notification");
      }
    })();
  }
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
  const { version: clientVersion, ...fieldsToUpdate } = parsed.data;
  const patch: Record<string, unknown> = {
    ...fieldsToUpdate,
    version: sql`${eventsTable.version} + 1`,
  };
  if (fieldsToUpdate.budget !== undefined) {
    patch.budget = String(fieldsToUpdate.budget);
  }
  if (fieldsToUpdate.eventAt !== undefined) {
    patch.eventAt = new Date(fieldsToUpdate.eventAt);
  }
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable).set(patch).where(updateWhere).returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: when a concrete time is locked in (date set to a real
  // value that changed), tell attendees the best time is set.
  const newDate = parsed.data.date?.trim();
  const dateLockedIn =
    newDate !== undefined &&
    newDate !== "" &&
    newDate.toUpperCase() !== "TBD" &&
    newDate !== existing.date;
  if (dateLockedIn) {
    void (async () => {
      try {
        const rsvps = (event.rsvps ?? {}) as Record<string, string>;
        const recipientIds = Object.keys(rsvps).filter((uid) => uid !== event.hostId);
        if (recipientIds.length === 0) return;
        // Squad events respect per-squad mute; standalone events skip the filter.
        const unmuted = event.squadId
          ? await storage.filterUnmutedForSquad(recipientIds, event.squadId)
          : recipientIds;
        if (unmuted.length === 0) return;
        const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
        if (tokens.length === 0) return;

        await sendPushNotifications(
          tokens,
          {
            title: `${event.emoji} ${event.title}`,
            body: `The time is set: ${newDate}`,
            data: { screen: "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending best-time-locked push notifications");
      }
    })();
  }
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
  emitEventUpdate(id);
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
  const { status } = parsed.data;
  // Atomic per-user RSVP merge: each user only ever writes their OWN key in the
  // rsvps JSON map, so we merge that single key server-side (`||`) instead of a
  // read-modify-write of the whole object. This removes the whole-row version
  // gate that made concurrent RSVPs from different users spuriously 409 (a
  // disjoint-key "conflict") and also closes the lost-update window.
  const [event] = await db.update(eventsTable)
    .set({
      rsvps: sql`COALESCE(${eventsTable.rsvps}, '{}'::jsonb) || ${JSON.stringify({ [userId]: status })}::jsonb`,
      version: sql`${eventsTable.version} + 1`,
    })
    .where(eq(eventsTable.id, id))
    .returning();
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
  // Activity feed only celebrates "going" RSVPs. If the user switches away from
  // going (to maybe/notgoing), pull any existing row so the host's feed and the
  // RSVP-momentum banner never show a stale "is going" for someone who backed out.
  if (parsed.data.status === "going") {
    recordActivitySafe({
      recipientId: event.hostId,
      actorId: userId,
      type: "rsvp",
      subjectType: "event",
      subjectId: event.id,
      meta: { rsvpStatus: "going", subjectName: event.title, subjectEmoji: event.emoji },
      dedupe: true,
    });
  } else {
    removeActivity({
      recipientId: event.hostId,
      actorId: userId,
      type: "rsvp",
      subjectId: event.id,
    });
  }

  // Fire-and-forget: tell the host who responded and how (skip self-RSVP).
  if (event.hostId !== userId) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([event.hostId], { requireNotifyFriendActivity: true });
        if (tokens.length === 0) return;
        const responder = await storage.getUser(userId);
        const label = RSVP_LABEL[parsed.data.status] ?? "responded";
        await sendPushNotifications(
          tokens,
          {
            title: `${event.emoji} ${event.title}`,
            body: `${displayName(responder)} ${label}`,
            data: { screen: "event", eventId: event.id },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending RSVP push notification");
      }
    })();
  }
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
  const { version: clientVersion, title, category } = parsed.data;
  const tasks = [
    ...(existing.tasks as unknown[]),
    { id: `t${Date.now()}`, title, category: category ?? null, assigneeId: null, done: false },
  ];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ tasks, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
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
  const { version: clientVersion, ...taskFields } = parsed.data;
  const tasks = (existing.tasks as Array<{ id: string; done: boolean; assigneeId: string | null; title: string }>).map(
    (t) => (t.id === taskId ? { ...t, ...taskFields } : t),
  );
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ tasks, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
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
  // Every referenced user (payer + each share) must be a legitimate participant
  // of this event, and each user may appear at most once. This blocks spoofing
  // arbitrary debts, mis-firing "you owe" pushes, and leaking payment handles.
  const allowed = await allowedParticipantIds(existing);
  if (!allowed.has(parsed.data.paidById)) {
    res.status(400).json({ error: "The payer must be a member of this event" });
    return;
  }
  const seenShareUsers = new Set<string>();
  for (const s of shares as Array<{ userId: string }>) {
    if (!allowed.has(s.userId)) {
      res.status(400).json({ error: "A share references someone who isn't a member of this event" });
      return;
    }
    if (seenShareUsers.has(s.userId)) {
      res.status(400).json({ error: "Each person can appear at most once in a cost split" });
      return;
    }
    seenShareUsers.add(s.userId);
  }
  const { version: clientVersion, ...costFields } = parsed.data;
  const newCost = { id: `c${Date.now()}`, ...costFields };
  const costs = [...(existing.costs as unknown[]), newCost];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: tell each person who now owes a share that they owe the payer.
  void (async () => {
    try {
      const payerId = newCost.paidById;
      const debtors = newCost.shares.filter(
        (s: { userId: string; amount: number }) => s.userId !== payerId && s.amount > 0,
      );
      if (debtors.length === 0) return;
      const payer = await storage.getUser(payerId);
      const payerName = displayName(payer);
      for (const debtor of debtors) {
        const tokens = await storage.getPushTokensForUsers([debtor.userId], { requireNotifyPayments: true });
        if (tokens.length === 0) continue;
        await sendPushNotifications(
          tokens,
          {
            title: "💸 New expense to settle",
            body: `You owe ${payerName} $${debtor.amount.toFixed(2)} for ${newCost.description}`,
            data: { screen: "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      }
    } catch (err) {
      logger.error({ err }, "Error sending expense-share push notifications");
    }
  })();
});

type StoredShare = { userId: string; amount: number; paidAt?: string | null; confirmedAt?: string | null };
type StoredCost = { id: string; description: string; amount: number; paidById: string; shares: StoredShare[] };

const MarkPaidBody = z.object({ paid: z.boolean(), version: z.number().int().optional() });
const ConfirmShareBody = z.object({ confirmed: z.boolean(), version: z.number().int().optional() });

// A debtor marks (or un-marks) their OWN share of a cost as paid. Records who/when.
// Cannot change a share the creditor has already confirmed.
router.post("/events/:id/costs/:costId/mark-paid", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const userId = (req.user as { id: string }).id;
  const parsed = MarkPaidBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (cost.paidById === userId) {
    res.status(400).json({ error: "The payer has nothing to mark as paid" });
    return;
  }
  const share = cost.shares.find((s) => s.userId === userId);
  if (!share || share.amount <= 0) {
    res.status(400).json({ error: "You have no share to settle on this expense" });
    return;
  }
  if (share.confirmedAt) {
    res.status(409).json({ error: "This payment was already confirmed by the payer" });
    return;
  }
  const wasUnpaid = !share.paidAt;
  share.paidAt = parsed.data.paid ? new Date().toISOString() : null;
  const nextCosts = costs.map((c) =>
    c.id !== costId ? c : { ...c, shares: cost.shares.map((s) => (s.userId === userId ? share : s)) },
  );
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);

  // Fire-and-forget: notify the creditor when a debtor newly marks a share paid.
  if (parsed.data.paid && wasUnpaid) {
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([cost.paidById], { requireNotifyPayments: true });
        if (tokens.length === 0) return;
        const debtor = await storage.getUser(userId);
        await sendPushNotifications(
          tokens,
          {
            title: "✅ Payment marked as sent",
            body: `${displayName(debtor)} marked $${share.amount.toFixed(2)} as paid for ${cost.description}`,
            data: { screen: "event", eventId: id, tab: "costs" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending payment-marked push notification");
      }
    })();
  }
});

// The creditor (cost payer) confirms a debtor's payment, or un-marks it (resets
// the share to unpaid) when the money never arrived.
router.post("/events/:id/costs/:costId/shares/:shareUserId/confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const costId = parseId(req.params.costId);
  const shareUserId = parseId(req.params.shareUserId);
  const userId = (req.user as { id: string }).id;
  const parsed = ConfirmShareBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  const costs = existing.costs as StoredCost[];
  const cost = costs.find((c) => c.id === costId);
  if (!cost) {
    res.status(404).json({ error: "Cost not found" });
    return;
  }
  if (cost.paidById !== userId) {
    res.status(403).json({ error: "Only the payer can confirm or un-mark a payment" });
    return;
  }
  const share = cost.shares.find((s) => s.userId === shareUserId);
  if (!share) {
    res.status(404).json({ error: "Share not found" });
    return;
  }
  if (parsed.data.confirmed) {
    if (!share.paidAt) {
      res.status(409).json({ error: "This share has not been marked as paid yet" });
      return;
    }
    share.confirmedAt = new Date().toISOString();
  } else {
    // Un-mark: reset to fully unpaid so the debtor must pay again.
    share.paidAt = null;
    share.confirmedAt = null;
  }
  const nextCosts = costs.map((c) =>
    c.id !== costId ? c : { ...c, shares: cost.shares.map((s) => (s.userId === shareUserId ? share : s)) },
  );
  const clientVersion = parsed.data.version;
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ costs: nextCosts, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// Member-authorized lookup of payment handles for everyone referenced in an
// event, so the settle-up UI can deep-link into Venmo/Cash App/Zelle.
router.get("/events/:id/payment-handles", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;
  const existing = await getEventAsMember(id, userId, res);
  if (!existing) return;
  // Only expose handles for legitimate event participants — never arbitrary IDs
  // that may have been injected into costs.
  const allowed = await allowedParticipantIds(existing);
  const users = await storage.getUsers([...allowed]);
  const handles: Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }> = {};
  for (const u of users) {
    handles[u.id] = {
      venmo: u.venmoHandle ?? null,
      cashapp: u.cashappHandle ?? null,
      zelle: u.zelleHandle ?? null,
    };
  }
  res.json({ handles });
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
  const { version: clientVersion, question, options } = parsed.data;
  const pollId = `p${Date.now()}`;
  const polls = [
    ...(existing.polls as unknown[]),
    {
      id: pollId,
      question,
      options: options.map((label: string, i: number) => ({ id: `po${Date.now()}${i}`, label, voterIds: [] })),
    },
  ];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ polls, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
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
  const { optionId, version: clientVersion } = parsed.data;
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
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ polls, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
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
  const { version: clientVersion, text } = parsed.data;
  const messages = [
    ...(existing.messages as unknown[]),
    { id: `m${Date.now()}`, senderId: userId, text, time: "Just now" },
  ];
  const updateWhere = clientVersion !== undefined
    ? and(eq(eventsTable.id, id), eq(eventsTable.version, clientVersion))
    : eq(eventsTable.id, id);
  const [event] = await db.update(eventsTable)
    .set({ messages, version: sql`${eventsTable.version} + 1` })
    .where(updateWhere)
    .returning();
  if (!event) {
    res.status(409).json({ error: "Someone else just updated this — refresh to see the latest", conflict: true });
    return;
  }
  res.json(event);
  emitEventUpdate(id);
});

// GET /events/:id/stream — SSE endpoint for real-time event updates.
// Members connect while the event detail screen is focused. Any mutation
// (RSVP, patch, join, tasks, costs, polls, messages) calls emitEventUpdate(id)
// which pushes an "update" event to all connected watchers immediately.
router.get("/events/:id/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;

  // Verify access before opening the stream.
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, id));
  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  const rsvps = (event.rsvps ?? {}) as Record<string, string>;
  if (event.hostId !== userId && !(userId in rsvps)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  // SSE response headers.
  // no-transform stops the compression middleware from buffering the stream.
  // X-Accel-Buffering: no disables nginx / Replit proxy buffering.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Confirm connection to the client.
  res.write("event: connected\ndata: {}\n\n");

  const unsubscribe = onEventUpdate(id, () => {
    res.write(`event: update\ndata: {"eventId":"${id}"}\n\n`);
  });

  // Keep-alive heartbeat every 25 s to prevent proxy/mobile connection timeouts.
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
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

    // Event vault photos are open to anyone with event access (no time lock).
    const photos = await storage.getPhotosByEventId(eventId);
    res.json({ photos, isPro });
  } catch (err) {
    logger.error({ err }, 'Error fetching event photos');
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

export default router;
