import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  planIdeasTable,
  ideaVotesTable,
  eventsTable,
  usersTable,
  squadsTable,
  IDEA_CATEGORIES,
} from "@workspace/db";
import { storage } from "../storage";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { shouldSendNotification } from "../lib/notificationDebounce";
import { recordActivitySafe } from "../lib/activity";
import { trackEvent } from "../services/analytics";
import { userCanAccessEvent, canManageEvent } from "./events";
import { getBlockedAndBlockerIds } from "./moderation";

/**
 * Plan Ideas — suggest & vote on activities for a plan (event or trip).
 *
 * Ideas are an open-ended, ongoing list ranked by votes; they are fully
 * separate from availability polls and from itinerary stops. Votes never
 * auto-confirm anything — only an explicit organizer/co-admin confirm moves an
 * idea into the merged itinerary view, where it renders as the SAME record
 * (no copy). Free for all users; no Squadz+ gate, no plan-cap interaction.
 */
const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

type EventRow = typeof eventsTable.$inferSelect;
type IdeaRow = typeof planIdeasTable.$inferSelect;

// ── Shared validation ─────────────────────────────────────────────────────────

/** Rejects malformed URLs with a clear client error instead of a 500. */
function normalizeLinkUrl(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false };
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false };
  }
}

const IdeaContentBody = z.object({
  title: z.string().trim().min(1, "Title is required").max(100),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.enum(IDEA_CATEGORIES).optional(),
  linkUrl: z.string().trim().max(500).optional().nullable(),
  estimatedCost: z.number().min(0).max(1_000_000).optional().nullable(),
  suggestedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date like 2026-07-18")
    .optional()
    .nullable(),
});

/** ISO day key ("YYYY-MM-DD") — the same convention ItineraryStop.day uses. */
function dayKeyOf(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Validates a suggested date against the trip's machine date range using the
 * same day keys the itinerary stops group by. Lenient when the trip has no
 * machine dates (legacy rows) — there is no range to validate against.
 */
function suggestedDateError(event: EventRow, suggestedDate: string | null): string | null {
  if (suggestedDate === null) return null;
  if (event.type !== "trip") return "Only trips support a suggested date — events keep a flat idea list.";
  const start = event.startAt ?? event.eventAt;
  if (!start) return null;
  const end = event.endAt ?? start;
  const first = dayKeyOf(start);
  const last = dayKeyOf(end);
  if (suggestedDate < first || suggestedDate > last) {
    return `Suggested date must fall within the trip (${first} to ${last}).`;
  }
  return null;
}

// ── Plan access helpers ───────────────────────────────────────────────────────

async function getPlanAsMember(
  planId: string,
  userId: string,
  res: Response,
): Promise<EventRow | null> {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, planId));
  if (!event) {
    res.status(404).json({ error: "Plan not found" });
    return null;
  }
  if (!(await userCanAccessEvent(event, userId))) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return event;
}

/**
 * Once a plan's end date has passed (or it was cancelled), Ideas becomes
 * read-only: existing ideas stay viewable but every mutation is rejected.
 * Same-day is still active, matching the list-expiry semantics elsewhere.
 */
function planIsReadOnly(event: EventRow): boolean {
  if (event.cancelled) return true;
  const end = event.endAt ?? event.startAt ?? event.eventAt;
  if (!end) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(end) < startOfToday;
}

function rejectReadOnly(event: EventRow, res: Response): boolean {
  if (!planIsReadOnly(event)) return false;
  res.status(403).json({
    error: event.cancelled
      ? "This plan was cancelled — ideas are read-only."
      : "This plan has ended — ideas are read-only.",
  });
  return true;
}

async function getIdeaInPlan(
  planId: string,
  ideaId: string,
  res: Response,
): Promise<IdeaRow | null> {
  const [idea] = await db
    .select()
    .from(planIdeasTable)
    .where(and(eq(planIdeasTable.id, ideaId), eq(planIdeasTable.planId, planId)));
  // A moderation-hidden idea is indistinguishable from a missing one.
  if (!idea || idea.status === "hidden") {
    res.status(404).json({ error: "Idea not found" });
    return null;
  }
  return idea;
}

/** Every user who counts as a member of the plan (same union the push fan-outs use). */
async function planMemberIds(event: EventRow): Promise<string[]> {
  const ids = new Set<string>([event.hostId]);
  for (const id of (event.coAdminIds ?? []) as string[]) ids.add(id);
  for (const id of (event.invitedUserIds ?? []) as string[]) ids.add(id);
  if (event.type !== "trip") {
    for (const id of Object.keys((event.rsvps ?? {}) as Record<string, string>)) ids.add(id);
  }
  if (event.squadId) {
    const [squad] = await db
      .select({ memberIds: squadsTable.memberIds })
      .from(squadsTable)
      .where(eq(squadsTable.id, event.squadId));
    for (const id of ((squad?.memberIds ?? []) as string[])) ids.add(id);
  }
  return [...ids];
}

function organizerIds(event: EventRow): string[] {
  return [event.hostId, ...(((event.coAdminIds ?? []) as string[]))].filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
}

async function displayName(userId: string): Promise<string> {
  const [row] = await db
    .select({ firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  return row?.firstName || row?.lastName || "Someone";
}

/** sort_order append slot at the end of a confirmed idea's day group (or General). */
async function nextSortOrder(planId: string, suggestedDate: string | null): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`MAX(${planIdeasTable.sortOrder})` })
    .from(planIdeasTable)
    .where(
      and(
        eq(planIdeasTable.planId, planId),
        eq(planIdeasTable.status, "confirmed"),
        suggestedDate === null
          ? sql`${planIdeasTable.suggestedDate} IS NULL`
          : eq(planIdeasTable.suggestedDate, suggestedDate),
      ),
    );
  return (row?.max ?? 0) + 1;
}

// ── Notifications ─────────────────────────────────────────────────────────────

/** Debounced "new idea(s) added" digest — several ideas in a short window = one push per recipient. */
async function notifyNewIdea(event: EventRow, actorId: string, ideaTitle: string): Promise<void> {
  try {
    const members = (await planMemberIds(event)).filter((id) => id !== actorId);
    if (members.length === 0) return;
    const unmuted = event.squadId
      ? await storage.filterUnmutedForSquad(members, event.squadId)
      : members;
    const debounced = unmuted.filter((recipientId) =>
      shouldSendNotification(actorId, recipientId, "idea_digest", 2 * 60 * 1000),
    );
    if (debounced.length === 0) return;
    const tokens = await storage.getPushTokensForUsers(debounced, { requireNotifyEventInvites: true });
    if (tokens.length === 0) return;
    const actorName = await displayName(actorId);
    await sendPushNotifications(tokens, {
      title: `💡 New idea for ${event.title}`,
      body: `${actorName} suggested "${ideaTitle}" — see what's brewing`,
      data: { type: "idea_digest", eventId: event.id, eventType: event.type },
    });
  } catch (err) {
    logger.error({ err, eventId: event.id }, "[ideas] new-idea digest notification failed");
  }
}

/** One-time organizer nudge when an idea crosses the vote threshold. */
async function maybeSendThresholdNudge(event: EventRow, idea: IdeaRow, actorId: string): Promise<void> {
  try {
    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingCount = Object.values(rsvps).filter((s) => s === "going").length;
    // 0–2 "going" RSVPs → never fires (a single early vote must not trigger it).
    if (goingCount < 3) return;
    const needed = Math.max(Math.floor(goingCount / 2) + 1, 3);
    const [{ voteCount }] = await db
      .select({ voteCount: sql<number>`COUNT(*)::int` })
      .from(ideaVotesTable)
      .where(eq(ideaVotesTable.ideaId, idea.id));
    if (voteCount < needed) return;
    // Atomic claim: once per idea, ever — even if RSVPs later change.
    const claimed = await db
      .update(planIdeasTable)
      .set({ nudgeSentAt: new Date() })
      .where(and(eq(planIdeasTable.id, idea.id), sql`${planIdeasTable.nudgeSentAt} IS NULL`))
      .returning({ id: planIdeasTable.id });
    if (claimed.length === 0) return;
    const recipients = organizerIds(event).filter((id) => id !== actorId);
    if (recipients.length === 0) return;
    const unmuted = event.squadId
      ? await storage.filterUnmutedForSquad(recipients, event.squadId)
      : recipients;
    for (const recipientId of unmuted) {
      recordActivitySafe({
        recipientId,
        actorId,
        type: "idea_threshold",
        subjectType: "event",
        subjectId: event.id,
        meta: { subjectName: event.title, subjectEmoji: event.emoji, ideaTitle: idea.title },
        dedupe: true,
      });
    }
    const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
    if (tokens.length === 0) return;
    await sendPushNotifications(tokens, {
      title: `🔥 An idea is taking off in ${event.title}`,
      body: `"${idea.title}" hit ${voteCount} votes — review it when you get a chance`,
      data: { type: "idea_threshold", eventId: event.id, eventType: event.type, ideaId: idea.id },
    });
  } catch (err) {
    logger.error({ err, ideaId: idea.id }, "[ideas] vote-threshold nudge failed");
  }
}

/** "Idea confirmed" — notify plan members once per confirm action. */
async function notifyIdeaConfirmed(event: EventRow, idea: IdeaRow, actorId: string): Promise<void> {
  try {
    const members = (await planMemberIds(event)).filter((id) => id !== actorId);
    if (members.length === 0) return;
    const unmuted = event.squadId
      ? await storage.filterUnmutedForSquad(members, event.squadId)
      : members;
    if (idea.submittedByUserId !== actorId) {
      recordActivitySafe({
        recipientId: idea.submittedByUserId,
        actorId,
        type: "idea_confirmed",
        subjectType: "event",
        subjectId: event.id,
        meta: { subjectName: event.title, subjectEmoji: event.emoji, ideaTitle: idea.title },
        dedupe: true,
      });
    }
    const tokens = await storage.getPushTokensForUsers(unmuted, { requireNotifyEventInvites: true });
    if (tokens.length === 0) return;
    await sendPushNotifications(tokens, {
      title: `✅ It's happening — ${event.title}`,
      body: `"${idea.title}" made the plan`,
      data: { type: "idea_confirmed", eventId: event.id, eventType: event.type, ideaId: idea.id },
    });
  } catch (err) {
    logger.error({ err, ideaId: idea.id }, "[ideas] confirmed notification failed");
  }
}

// ── Serialization ─────────────────────────────────────────────────────────────

type SubmitterInfo = { id: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null };

function serializeIdea(
  idea: IdeaRow,
  voteCount: number,
  votedByMe: boolean,
  submitter: SubmitterInfo | null,
) {
  return {
    id: idea.id,
    planId: idea.planId,
    title: idea.title,
    description: idea.description,
    category: idea.category,
    linkUrl: idea.linkUrl,
    estimatedCost: idea.estimatedCost === null ? null : Number(idea.estimatedCost),
    suggestedDate: idea.suggestedDate,
    status: idea.status,
    pinned: idea.pinnedAt !== null,
    sortOrder: idea.sortOrder,
    createdAt: idea.createdAt,
    updatedAt: idea.updatedAt,
    submittedBy: submitter,
    voteCount,
    votedByMe,
  };
}

async function serializeOne(idea: IdeaRow, viewerId: string) {
  const blocked = new Set(await getBlockedAndBlockerIds(viewerId));
  const votes = await db
    .select({ userId: ideaVotesTable.userId })
    .from(ideaVotesTable)
    .where(eq(ideaVotesTable.ideaId, idea.id));
  const visibleVotes = votes.filter((v) => !blocked.has(v.userId));
  const [submitter] = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.id, idea.submittedByUserId));
  return serializeIdea(
    idea,
    visibleVotes.length,
    visibleVotes.some((v) => v.userId === viewerId),
    submitter ?? null,
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/plans/:planId/ideas — submit an idea (any plan member).
router.post("/plans/:planId/ideas", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (rejectReadOnly(event, res)) return;

    const parsed = IdeaContentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid idea" });
      return;
    }
    const body = parsed.data;
    const link = normalizeLinkUrl(body.linkUrl);
    if (!link.ok) {
      res.status(400).json({ error: "That link doesn't look like a valid URL (must start with http:// or https://)." });
      return;
    }
    const suggestedDate = body.suggestedDate ?? null;
    const dateErr = suggestedDateError(event, suggestedDate);
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    const [idea] = await db
      .insert(planIdeasTable)
      .values({
        planId,
        submittedByUserId: userId,
        title: body.title,
        description: body.description?.trim() || null,
        category: event.type === "trip" ? (body.category ?? "activity") : "activity",
        linkUrl: link.value,
        estimatedCost: body.estimatedCost != null ? String(body.estimatedCost) : null,
        suggestedDate: event.type === "trip" ? suggestedDate : null,
        status: "pending",
      })
      .returning();

    trackEvent(userId, "idea_created", { planId, planType: event.type, category: idea.category });
    void notifyNewIdea(event, userId, idea.title);
    res.json(await serializeOne(idea, userId));
  } catch (err) {
    logger.error({ err }, "[ideas] create failed");
    res.status(500).json({ error: "Failed to create idea" });
  }
});

// GET /api/plans/:planId/ideas — list (members only; reads stay open after plan end).
router.get("/plans/:planId/ideas", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;

    const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
    const categoryFilter = typeof req.query.category === "string" ? req.query.category : null;
    const sort = req.query.sort === "created" ? "created" : "votes";

    const blocked = new Set(await getBlockedAndBlockerIds(userId));
    let ideas = (
      await db.select().from(planIdeasTable).where(eq(planIdeasTable.planId, planId))
    ).filter((i) => i.status !== "hidden" && !blocked.has(i.submittedByUserId));
    if (statusFilter) ideas = ideas.filter((i) => i.status === statusFilter);
    if (categoryFilter) ideas = ideas.filter((i) => i.category === categoryFilter);

    const ideaIds = ideas.map((i) => i.id);
    const votes = ideaIds.length
      ? await db
          .select({ ideaId: ideaVotesTable.ideaId, userId: ideaVotesTable.userId })
          .from(ideaVotesTable)
          .where(sql`${ideaVotesTable.ideaId} IN (${sql.join(ideaIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const countByIdea = new Map<string, number>();
    const mineByIdea = new Set<string>();
    for (const v of votes) {
      if (blocked.has(v.userId)) continue; // blocked users' votes excluded from what this viewer sees
      countByIdea.set(v.ideaId, (countByIdea.get(v.ideaId) ?? 0) + 1);
      if (v.userId === userId) mineByIdea.add(v.ideaId);
    }

    const submitterIds = [...new Set(ideas.map((i) => i.submittedByUserId))];
    const submitters = submitterIds.length
      ? await db
          .select({
            id: usersTable.id,
            firstName: usersTable.firstName,
            lastName: usersTable.lastName,
            profileImageUrl: usersTable.profileImageUrl,
          })
          .from(usersTable)
          .where(sql`${usersTable.id} IN (${sql.join(submitterIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
    const submitterById = new Map(submitters.map((s) => [s.id, s]));

    const rows = ideas.map((i) =>
      serializeIdea(i, countByIdea.get(i.id) ?? 0, mineByIdea.has(i.id), submitterById.get(i.submittedByUserId) ?? null),
    );
    rows.sort((a, b) => {
      // Pinned ideas top the list regardless of votes.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "votes" && a.voteCount !== b.voteCount) return b.voteCount - a.voteCount;
      return new Date(b.createdAt as unknown as string).getTime() - new Date(a.createdAt as unknown as string).getTime();
    });

    res.json({ ideas: rows, readOnly: planIsReadOnly(event) });
  } catch (err) {
    logger.error({ err }, "[ideas] list failed");
    res.status(500).json({ error: "Failed to load ideas" });
  }
});

// PATCH /api/plans/:planId/ideas/reorder — organizer/co-admin reorders confirmed
// ideas within ONE day group (or General). Ideas order among themselves only —
// itinerary stop ordering is a separate system and is never touched here.
// NOTE: registered before "/:id" so "reorder" isn't captured as an idea id.
router.patch("/plans/:planId/ideas/reorder", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (!canManageEvent(event, userId)) {
      res.status(403).json({ error: "Only the organizer or co-admins can reorder" });
      return;
    }
    if (rejectReadOnly(event, res)) return;

    const Body = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      ideaIds: z.array(z.string().min(1)).min(1).max(200),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid fields" });
      return;
    }
    const { date, ideaIds } = parsed.data;
    if (new Set(ideaIds).size !== ideaIds.length) {
      res.status(400).json({ error: "Duplicate idea ids in payload" });
      return;
    }

    // The payload must be exactly the confirmed ideas of this group — any
    // foreign-plan, non-confirmed, or missing id rejects the whole request.
    const groupIdeas = (
      await db
        .select({ id: planIdeasTable.id })
        .from(planIdeasTable)
        .where(
          and(
            eq(planIdeasTable.planId, planId),
            eq(planIdeasTable.status, "confirmed"),
            date === null
              ? sql`${planIdeasTable.suggestedDate} IS NULL`
              : eq(planIdeasTable.suggestedDate, date),
          ),
        )
    ).map((r) => r.id);
    const groupSet = new Set(groupIdeas);
    if (ideaIds.length !== groupIdeas.length || !ideaIds.every((id) => groupSet.has(id))) {
      res.status(400).json({ error: "Reorder payload must contain exactly the confirmed ideas of this group" });
      return;
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < ideaIds.length; i++) {
        await tx
          .update(planIdeasTable)
          .set({ sortOrder: i + 1, updatedAt: new Date() })
          .where(and(eq(planIdeasTable.id, ideaIds[i]), eq(planIdeasTable.planId, planId)));
      }
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ideas] reorder failed");
    res.status(500).json({ error: "Failed to reorder ideas" });
  }
});

// PATCH /api/plans/:planId/ideas/:id — edit content. Submitter: own idea while
// pending only. Organizer/co-admin: any idea at any status.
router.patch("/plans/:planId/ideas/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const ideaId = parseId(req.params.id);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (rejectReadOnly(event, res)) return;
    const idea = await getIdeaInPlan(planId, ideaId, res);
    if (!idea) return;

    const isManager = canManageEvent(event, userId);
    if (!isManager) {
      if (idea.submittedByUserId !== userId) {
        res.status(403).json({ error: "You can only edit your own ideas" });
        return;
      }
      if (idea.status !== "pending") {
        res.status(403).json({ error: "This idea is locked — ask an organizer to edit it" });
        return;
      }
    }

    const parsed = IdeaContentBody.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid idea" });
      return;
    }
    const body = parsed.data;
    const updates: Partial<typeof planIdeasTable.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description?.trim() || null;
    if (body.category !== undefined && event.type === "trip") updates.category = body.category ?? "activity";
    if (body.estimatedCost !== undefined) {
      updates.estimatedCost = body.estimatedCost != null ? String(body.estimatedCost) : null;
    }
    if (body.linkUrl !== undefined) {
      const link = normalizeLinkUrl(body.linkUrl);
      if (!link.ok) {
        res.status(400).json({ error: "That link doesn't look like a valid URL (must start with http:// or https://)." });
        return;
      }
      updates.linkUrl = link.value;
    }
    if (body.suggestedDate !== undefined) {
      const suggestedDate = body.suggestedDate ?? null;
      const dateErr = suggestedDateError(event, suggestedDate);
      if (dateErr) {
        res.status(400).json({ error: dateErr });
        return;
      }
      updates.suggestedDate = event.type === "trip" ? suggestedDate : null;
      // Moving a CONFIRMED idea to a different day group appends it to the end
      // of the target group; the source group keeps its relative order.
      if (idea.status === "confirmed" && (suggestedDate ?? null) !== (idea.suggestedDate ?? null)) {
        updates.sortOrder = await nextSortOrder(planId, suggestedDate);
      }
    }

    const [updated] = await db
      .update(planIdeasTable)
      .set(updates)
      .where(eq(planIdeasTable.id, idea.id))
      .returning();
    res.json(await serializeOne(updated, userId));
  } catch (err) {
    logger.error({ err }, "[ideas] edit failed");
    res.status(500).json({ error: "Failed to update idea" });
  }
});

// DELETE /api/plans/:planId/ideas/:id — submitter (own, pending only) or
// organizer/co-admin (any idea, any status — confirmed leaves the itinerary).
router.delete("/plans/:planId/ideas/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const ideaId = parseId(req.params.id);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (rejectReadOnly(event, res)) return;
    const idea = await getIdeaInPlan(planId, ideaId, res);
    if (!idea) return;

    const isManager = canManageEvent(event, userId);
    if (!isManager) {
      if (idea.submittedByUserId !== userId) {
        res.status(403).json({ error: "You can only delete your own ideas" });
        return;
      }
      if (idea.status !== "pending") {
        res.status(403).json({ error: "This idea is locked — ask an organizer to remove it" });
        return;
      }
    }

    // Votes go with the idea (also enforced by the FK cascade).
    await db.transaction(async (tx) => {
      await tx.delete(ideaVotesTable).where(eq(ideaVotesTable.ideaId, idea.id));
      await tx.delete(planIdeasTable).where(eq(planIdeasTable.id, idea.id));
    });
    trackEvent(userId, "idea_deleted", { planId, ideaId: idea.id, status: idea.status });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ideas] delete failed");
    res.status(500).json({ error: "Failed to delete idea" });
  }
});

// POST /api/plans/:planId/ideas/:id/vote — toggle the caller's upvote.
// Idempotent: on/off, never errors or double-counts (atomic DELETE-then-INSERT).
router.post("/plans/:planId/ideas/:id/vote", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const ideaId = parseId(req.params.id);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (rejectReadOnly(event, res)) return;
    const idea = await getIdeaInPlan(planId, ideaId, res);
    if (!idea) return;
    if (idea.status !== "pending") {
      res.status(400).json({ error: "Voting is only open while an idea is pending" });
      return;
    }

    // Atomic toggle: DELETE…RETURNING claims the "off" path; otherwise INSERT
    // with ON CONFLICT DO NOTHING claims "on" without read-then-write races.
    const removed = await db
      .delete(ideaVotesTable)
      .where(and(eq(ideaVotesTable.ideaId, idea.id), eq(ideaVotesTable.userId, userId)))
      .returning({ id: ideaVotesTable.id });
    let voted: boolean;
    if (removed.length > 0) {
      voted = false;
    } else {
      await db
        .insert(ideaVotesTable)
        .values({ ideaId: idea.id, userId })
        .onConflictDoNothing();
      voted = true;
    }

    trackEvent(userId, "idea_voted", { planId, ideaId: idea.id, direction: voted ? "on" : "off" });
    if (voted) void maybeSendThresholdNudge(event, idea, userId);
    res.json(await serializeOne(idea, userId));
  } catch (err) {
    logger.error({ err }, "[ideas] vote failed");
    res.status(500).json({ error: "Failed to vote" });
  }
});

// PATCH /api/plans/:planId/ideas/:id/status — organizer/co-admin transitions.
router.patch("/plans/:planId/ideas/:id/status", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const ideaId = parseId(req.params.id);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (!canManageEvent(event, userId)) {
      res.status(403).json({ error: "Only the organizer or co-admins can change idea status" });
      return;
    }
    if (rejectReadOnly(event, res)) return;
    const idea = await getIdeaInPlan(planId, ideaId, res);
    if (!idea) return;

    const Body = z.object({ status: z.enum(["pending", "confirmed", "archived"]) });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid status" });
      return;
    }
    const target = parsed.data.status;
    const allowed: Record<string, string[]> = {
      pending: ["confirmed", "archived"],
      confirmed: ["pending"],
      archived: ["pending"],
    };
    if (!allowed[idea.status]?.includes(target)) {
      res.status(400).json({ error: `Can't move an idea from ${idea.status} to ${target}` });
      return;
    }

    const updates: Partial<typeof planIdeasTable.$inferInsert> = { status: target, updatedAt: new Date() };
    if (target === "confirmed") {
      // Append to the end of its day group (or General) in the merged itinerary.
      updates.sortOrder = await nextSortOrder(planId, idea.suggestedDate ?? null);
    } else {
      // Un-confirm / archive / reactivate all leave the itinerary ordering.
      updates.sortOrder = null;
    }

    const [updated] = await db
      .update(planIdeasTable)
      .set(updates)
      .where(eq(planIdeasTable.id, idea.id))
      .returning();

    if (target === "confirmed") {
      trackEvent(userId, "idea_confirmed", { planId, ideaId: idea.id });
      void notifyIdeaConfirmed(event, updated, userId);
    }
    res.json(await serializeOne(updated, userId));
  } catch (err) {
    logger.error({ err }, "[ideas] status change failed");
    res.status(500).json({ error: "Failed to update idea status" });
  }
});

// POST /api/plans/:planId/ideas/:id/pin — organizer/co-admin toggle; no notification.
router.post("/plans/:planId/ideas/:id/pin", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const planId = parseId(req.params.planId);
    const ideaId = parseId(req.params.id);
    const event = await getPlanAsMember(planId, userId, res);
    if (!event) return;
    if (!canManageEvent(event, userId)) {
      res.status(403).json({ error: "Only the organizer or co-admins can pin ideas" });
      return;
    }
    if (rejectReadOnly(event, res)) return;
    const idea = await getIdeaInPlan(planId, ideaId, res);
    if (!idea) return;

    const [updated] = await db
      .update(planIdeasTable)
      .set({ pinnedAt: idea.pinnedAt ? null : new Date(), updatedAt: new Date() })
      .where(eq(planIdeasTable.id, idea.id))
      .returning();
    res.json(await serializeOne(updated, userId));
  } catch (err) {
    logger.error({ err }, "[ideas] pin failed");
    res.status(500).json({ error: "Failed to pin idea" });
  }
});

export default router;
