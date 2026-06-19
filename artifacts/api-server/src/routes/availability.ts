import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitPollUpdate, onPollUpdate } from "../lib/availabilityEvents";
import type { AvailabilityPoll } from "@workspace/db/schema";

type MemberInfo = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  hasResponded: boolean;
  needsUpdate: boolean;
  respondedAt: string | null;
  nudgedAt?: string | null;
};

function toDisplayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null }): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ");
  if (full) return full;
  return user.email?.split("@")[0] ?? "User";
}

async function buildMembersField(
  poll: AvailabilityPoll,
  responses: { userId: string; cells: string[]; updatedAt: Date }[],
): Promise<MemberInfo[]> {
  const responseMap = new Map(responses.map((r) => [r.userId, r]));
  const pollUpdatedAt = poll.updatedAt;

  // A member needsUpdate when:
  //   - they have never responded, OR
  //   - the poll's date range was updated more recently than their last response
  function memberNeedsUpdate(userId: string): boolean {
    const r = responseMap.get(userId);
    if (!r) return true;
    if (!pollUpdatedAt) return false;
    return r.updatedAt < pollUpdatedAt;
  }

  const respondentIds = new Set(responses.map((r) => r.userId));

  if (poll.squadId) {
    const squad = await storage.getSquad(poll.squadId);
    const memberIds: string[] = (squad?.memberIds as string[] | null) ?? [];
    const allIds = [...new Set([...memberIds, ...respondentIds])];
    const users = await storage.getUsers(allIds);
    return users.map((u) => {
      const resp = responseMap.get(u.id);
      return {
        id: u.id,
        displayName: toDisplayName(u),
        avatarUrl: u.profileImageUrl ?? null,
        hasResponded: respondentIds.has(u.id),
        needsUpdate: memberNeedsUpdate(u.id),
        respondedAt: resp?.updatedAt?.toISOString() ?? null,
      };
    });
  }
  // Ad-hoc poll: the roster is the explicit participant list (T3), unioned with
  // anyone who has already responded.
  const participantIds = (poll.participantIds as string[] | null) ?? [];
  if (participantIds.length > 0) {
    const allIds = [...new Set([...participantIds, ...respondentIds])];
    const users = await storage.getUsers(allIds);
    return users.map((u) => {
      const resp = responseMap.get(u.id);
      return {
        id: u.id,
        displayName: toDisplayName(u),
        avatarUrl: u.profileImageUrl ?? null,
        hasResponded: respondentIds.has(u.id),
        needsUpdate: memberNeedsUpdate(u.id),
        respondedAt: resp?.updatedAt?.toISOString() ?? null,
      };
    });
  }
  if (respondentIds.size > 0) {
    const users = await storage.getUsers([...respondentIds]);
    return users.map((u) => {
      const resp = responseMap.get(u.id);
      return {
        id: u.id,
        displayName: toDisplayName(u),
        avatarUrl: u.profileImageUrl ?? null,
        hasResponded: true,
        needsUpdate: memberNeedsUpdate(u.id),
        respondedAt: resp?.updatedAt?.toISOString() ?? null,
      };
    });
  }
  return [];
}

async function resolveUpdatedByName(poll: AvailabilityPoll): Promise<string | null> {
  if (!poll.updatedBy) return null;
  const users = await storage.getUsers([poll.updatedBy]);
  if (!users.length) return null;
  return toDisplayName(users[0]);
}

const NUDGE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const CreatePollBody = z
  .object({
    squadId: z.string().optional(),
    eventId: z.string().optional(),
    // Explicit invitee set for an ad-hoc "new plan" poll that isn't tied to a
    // squad or an existing event (T3 — pick who's in the planning).
    participantIds: z.array(z.string().min(1)).max(50).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    days: z.array(z.string().max(20)).max(31).optional(),
    slots: z.array(z.string().max(20)).max(48).optional(),
    // When true, always create a brand-new poll instead of reusing the latest
    // poll for this scope (T12 — "Find a time" starts fresh each time).
    forceNew: z.boolean().optional(),
    // Marks an ad-hoc "new plan" poll (T3). The roster is the creator plus any
    // chosen participantIds; an empty set is allowed (a solo poll the creator
    // then shares by link), so this flag — not a non-empty participantIds — is
    // what authorizes a squad/event-less poll.
    adhoc: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.squadId ||
      d.eventId ||
      d.adhoc ||
      (d.participantIds && d.participantIds.length > 0),
    {
      message: "A poll must be scoped to a squad, an event, or a set of participants",
    },
  );

const FindPollQuery = z
  .object({
    squadId: z.string().optional(),
    eventId: z.string().optional(),
  })
  .refine((d) => d.squadId || d.eventId, {
    message: "squadId or eventId is required",
  });

const UpsertResponseBody = z.object({
  cells: z.array(z.string().max(40)).max(1488),
});

const UpdatePollBody = z
  .object({
    title: z.string().trim().max(120).optional(),
    days: z.array(z.string().max(20)).min(1).max(31).optional(),
    slots: z.array(z.string().max(20)).min(1).max(48).optional(),
  })
  .refine((d) => d.title !== undefined || d.days || d.slots, {
    message: "At least one of title, days, or slots must be provided",
  });

const NudgeBody = z.object({
  targetUserId: z.string().min(1),
});

type AggregatedCell = { cell: string; count: number };

function buildPollPayload(
  poll: AvailabilityPoll,
  responses: { userId: string; cells: string[]; updatedAt: Date }[],
  userId: string,
  updatedByName?: string | null,
) {
  const counts = new Map<string, number>();
  const cellUsers: Record<string, string[]> = {};
  for (const r of responses) {
    for (const cell of r.cells) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
      if (!cellUsers[cell]) cellUsers[cell] = [];
      cellUsers[cell].push(r.userId);
    }
  }

  const heatmap: AggregatedCell[] = [...counts.entries()].map(([cell, count]) => ({
    cell,
    count,
  }));

  const respondentCount = responses.length;

  // Best pick = the cell(s) with the highest overlap. Tie-break by earliest
  // slot order in the poll's day/slot grid. Cells are keyed `${day}-${slot}`
  // where `day` may be an ISO date (which itself contains dashes), so split on
  // the LAST dash to recover the slot.
  let bestCell: string | null = null;
  let bestCount = 0;
  const order = (cell: string): number => {
    const i = cell.lastIndexOf("-");
    const day = i < 0 ? cell : cell.slice(0, i);
    const slot = i < 0 ? "" : cell.slice(i + 1);
    const di = poll.days.indexOf(day);
    const si = poll.slots.indexOf(slot);
    return (di < 0 ? 99 : di) * 100 + (si < 0 ? 99 : si);
  };
  for (const { cell, count } of heatmap) {
    if (count > bestCount || (count === bestCount && bestCell && order(cell) < order(bestCell))) {
      bestCell = cell;
      bestCount = count;
    }
  }

  const myResponse = responses.find((r) => r.userId === userId);

  return {
    poll: {
      id: poll.id,
      squadId: poll.squadId,
      eventId: poll.eventId,
      createdBy: poll.createdBy,
      title: poll.title,
      days: poll.days,
      slots: poll.slots,
      updatedAt: poll.updatedAt?.toISOString() ?? null,
      updatedBy: poll.updatedBy ?? null,
      updatedByName: updatedByName ?? null,
    },
    heatmap,
    cellUsers,
    respondentCount,
    myCells: myResponse?.cells ?? [],
    myResponseUpdatedAt: myResponse?.updatedAt?.toISOString() ?? null,
    memberCells: responses.map((r) => ({ userId: r.userId, cells: r.cells })),
    best:
      bestCell && bestCount > 0
        ? { cell: bestCell, count: bestCount, total: respondentCount }
        : null,
  };
}

/** Attach per-member nudge timestamps and the current user's nudge banner info
 *  to a poll payload. Called after buildMembersField. */
async function enrichWithNudgeData(
  pollId: string,
  userId: string,
  isCreator: boolean,
  members: MemberInfo[],
  respondentIds: Set<string>,
): Promise<{ members: MemberInfo[]; nudgedAt: string | null }> {
  const pendingIds = members.filter((m) => !m.hasResponded).map((m) => m.id);

  // For the creator: attach per-member last-nudge times (within debounce window)
  // so the mobile client can pre-disable nudge buttons on load.
  let recentNudgeMap = new Map<string, Date>();
  if (isCreator && pendingIds.length > 0) {
    recentNudgeMap = await storage.getRecentNudgesFromUser(
      pollId,
      userId,
      pendingIds,
      NUDGE_DEBOUNCE_MS,
    );
  }

  const enrichedMembers = members.map((m) => {
    const nudgeDate = recentNudgeMap.get(m.id);
    return { ...m, nudgedAt: nudgeDate ? nudgeDate.toISOString() : null };
  });

  // For the nudged user: check if they were nudged recently and haven't responded.
  let nudgedAt: string | null = null;
  if (!respondentIds.has(userId)) {
    const nudgeDate = await storage.getLatestNudgeForUser(pollId, userId);
    if (nudgeDate) nudgedAt = nudgeDate.toISOString();
  }

  return { members: enrichedMembers, nudgedAt };
}

/**
 * POST /api/availability/polls
 * Create (or reuse) a poll for a squad or event. Caller must be a member of the
 * squad or have access to the event.
 */
router.post("/availability/polls", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = CreatePollBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { squadId, eventId, participantIds, title, days, slots, forceNew } = parsed.data;

    // Access checks before creating.
    if (eventId) {
      const event = await storage.getEvent(eventId);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const canAccess = await storage.canAccessAvailabilityPoll(
        { eventId, squadId: event.squadId || null, createdBy: event.hostId } as AvailabilityPoll,
        userId,
      );
      if (!canAccess) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    } else if (squadId) {
      const member = await storage.canAccessAvailabilityPoll(
        { squadId, eventId: null, createdBy: "" } as AvailabilityPoll,
        userId,
      );
      if (!member) {
        res.status(403).json({ error: "Not a member of this squad" });
        return;
      }
    }

    // Reuse an existing poll for the same scope rather than creating duplicates,
    // UNLESS the caller asked for a fresh poll (forceNew — T12) or this is an
    // ad-hoc participant-scoped poll (which is always brand new — T3).
    const isAdHoc = !squadId && !eventId;
    const existing =
      forceNew || isAdHoc ? null : await storage.findAvailabilityPoll({ squadId, eventId });
    // For an ad-hoc poll always include the creator in the planning roster.
    const roster =
      isAdHoc && participantIds
        ? [...new Set([userId, ...participantIds])]
        : participantIds;
    const poll =
      existing ??
      (await storage.createAvailabilityPoll({
        createdBy: userId,
        squadId: squadId ?? null,
        eventId: eventId ?? null,
        participantIds: roster ?? null,
        title,
        days,
        slots,
      }));

    const responses = await storage.getAvailabilityResponses(poll.id);
    const [members, updatedByName] = await Promise.all([
      buildMembersField(poll, responses),
      resolveUpdatedByName(poll),
    ]);
    const isCreator = poll.createdBy === userId;
    const respondentIds = new Set(responses.map((r) => r.userId));
    const { members: enrichedMembers, nudgedAt } = await enrichWithNudgeData(
      poll.id, userId, isCreator, members, respondentIds,
    );
    res.status(existing ? 200 : 201).json({ ...buildPollPayload(poll, responses, userId, updatedByName), members: enrichedMembers, nudgedAt });
  } catch (err) {
    logger.error({ err }, "Error creating availability poll");
    res.status(500).json({ error: "Failed to create poll" });
  }
});

const ListPollsQuery = z
  .object({
    squadId: z.string().optional(),
    // "personal" → the caller's own ad-hoc polls (no squad, no event).
    scope: z.enum(["personal"]).optional(),
  })
  .refine((d) => d.squadId || d.scope === "personal", {
    message: "squadId or scope=personal is required",
  });

/**
 * GET /api/availability/polls?squadId=  | ?scope=personal
 * List ACTIVE (un-converted) polls for the New/Existing chooser. Squad scope is
 * gated on squad membership; personal scope returns only the caller's own
 * ad-hoc polls. Returns lightweight summaries (no heatmap).
 */
router.get("/availability/polls", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = ListPollsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { squadId, scope } = parsed.data;

    let squadMemberCount = 0;
    if (squadId) {
      const member = await storage.canAccessAvailabilityPoll(
        { squadId, eventId: null, createdBy: "" } as AvailabilityPoll,
        userId,
      );
      if (!member) {
        res.status(403).json({ error: "Not a member of this squad" });
        return;
      }
      const squad = await storage.getSquad(squadId);
      squadMemberCount = ((squad?.memberIds ?? []) as string[]).length;
    }

    const polls = squadId
      ? await storage.listAvailabilityPolls({ squadId })
      : await storage.listAvailabilityPolls({ createdBy: userId });

    const counts = await storage.countResponsesForPolls(polls.map((p) => p.id));

    const summaries = polls.map((p) => ({
      id: p.id,
      title: p.title,
      squadId: p.squadId,
      days: p.days,
      slots: p.slots,
      respondentCount: counts.get(p.id) ?? 0,
      memberCount: p.squadId
        ? squadMemberCount
        : ((p.participantIds as string[] | null) ?? []).length,
      createdBy: p.createdBy,
      mine: p.createdBy === userId,
      createdAt: p.createdAt?.toISOString() ?? null,
      updatedAt: p.updatedAt?.toISOString() ?? null,
    }));

    res.json({ polls: summaries });
  } catch (err) {
    logger.error({ err }, "Error listing availability polls");
    res.status(500).json({ error: "Failed to list polls" });
  }
});

/**
 * GET /api/availability/polls/find?squadId=&eventId=
 * Look up the latest poll for a scope. Returns 404 if none exists yet.
 */
router.get("/availability/polls/find", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = FindPollQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const poll = await storage.findAvailabilityPoll(parsed.data);
    if (!poll) {
      res.status(404).json({ error: "No poll found" });
      return;
    }
    if (!(await storage.canAccessAvailabilityPoll(poll, userId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const responses = await storage.getAvailabilityResponses(poll.id);
    const [members, updatedByName] = await Promise.all([
      buildMembersField(poll, responses),
      resolveUpdatedByName(poll),
    ]);
    const isCreator = poll.createdBy === userId;
    const respondentIds = new Set(responses.map((r) => r.userId));
    const { members: enrichedMembers, nudgedAt } = await enrichWithNudgeData(
      poll.id, userId, isCreator, members, respondentIds,
    );
    res.json({ ...buildPollPayload(poll, responses, userId, updatedByName), members: enrichedMembers, nudgedAt });
  } catch (err) {
    logger.error({ err }, "Error finding availability poll");
    res.status(500).json({ error: "Failed to find poll" });
  }
});

/**
 * GET /api/availability/polls/:id
 * Fetch a poll with the aggregated heatmap, the caller's own cells, and the
 * suggested best slot.
 */
router.get("/availability/polls/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const poll = await storage.getAvailabilityPoll(parseId(req.params.id));
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (!(await storage.canAccessAvailabilityPoll(poll, userId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const responses = await storage.getAvailabilityResponses(poll.id);
    const [members, updatedByName] = await Promise.all([
      buildMembersField(poll, responses),
      resolveUpdatedByName(poll),
    ]);
    const isCreator = poll.createdBy === userId;
    const respondentIds = new Set(responses.map((r) => r.userId));
    const { members: enrichedMembers, nudgedAt } = await enrichWithNudgeData(
      poll.id, userId, isCreator, members, respondentIds,
    );
    res.json({ ...buildPollPayload(poll, responses, userId, updatedByName), members: enrichedMembers, nudgedAt });
  } catch (err) {
    logger.error({ err }, "Error fetching availability poll");
    res.status(500).json({ error: "Failed to fetch poll" });
  }
});

/**
 * DELETE /api/availability/polls/:id
 * Permanently delete a poll. Only the poll creator may call this. Responses and
 * nudges cascade-delete via FK.
 */
router.delete("/availability/polls/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const poll = await storage.getAvailabilityPoll(parseId(req.params.id));
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (poll.createdBy !== userId) {
      res.status(403).json({ error: "Only the poll creator can delete this poll" });
      return;
    }
    await storage.deleteAvailabilityPoll(poll.id);
    res.json({ ok: true });
    // Notify any connected watchers; their next refetch will 404 and they'll exit.
    emitPollUpdate(poll.id);
  } catch (err) {
    logger.error({ err }, "Error deleting availability poll");
    res.status(500).json({ error: "Failed to delete poll" });
  }
});

const ConvertPollBody = z.object({ eventId: z.string().min(1).max(120) });

/**
 * POST /api/availability/polls/:id/convert
 * Mark a poll as "locked in" — it became the event/trip identified by eventId.
 * Only the poll creator may call this. A converted poll drops out of the
 * New/Existing chooser. Idempotent: re-converting just re-stamps the id.
 */
router.post("/availability/polls/:id/convert", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const poll = await storage.getAvailabilityPoll(parseId(req.params.id));
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (poll.createdBy !== userId) {
      res.status(403).json({ error: "Only the poll creator can convert this poll" });
      return;
    }
    const parsed = ConvertPollBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    await storage.markAvailabilityPollConverted(poll.id, parsed.data.eventId);
    res.json({ ok: true, convertedEventId: parsed.data.eventId });
  } catch (err) {
    logger.error({ err }, "Error converting availability poll");
    res.status(500).json({ error: "Failed to convert poll" });
  }
});

// GET /api/availability/polls/:id/stream — SSE endpoint for real-time poll
// updates. Participants connect while the availability screen is focused. Any
// mutation (member submits, host updates the range, host nudges) calls
// emitPollUpdate(id) which pushes an "update" event to all watchers immediately.
router.get("/availability/polls/:id/stream", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = parseId(req.params.id);
  const userId = (req.user as { id: string }).id;

  // Verify access before opening the stream.
  const poll = await storage.getAvailabilityPoll(id);
  if (!poll) {
    res.status(404).json({ error: "Poll not found" });
    return;
  }
  if (!(await storage.canAccessAvailabilityPoll(poll, userId))) {
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

  const unsubscribe = onPollUpdate(id, () => {
    res.write(`event: update\ndata: {"pollId":"${id}"}\n\n`);
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

/**
 * PATCH /api/availability/polls/:id
 * Update a poll's date range (days and/or slots). Only the poll creator may
 * call this. Existing responses are preserved but any cells that fall outside
 * the new grid are trimmed server-side.
 */
router.patch("/availability/polls/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const poll = await storage.getAvailabilityPoll(parseId(req.params.id));
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (poll.createdBy !== userId) {
      res.status(403).json({ error: "Only the poll creator can update the date range" });
      return;
    }
    const parsed = UpdatePollBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Snapshot the current range before updating so we can detect a real change.
    const prevDays = poll.days as string[];
    const prevSlots = poll.slots as string[];

    const updatedPoll = await storage.updateAvailabilityPoll(poll.id, parsed.data, userId);
    const responses = await storage.getAvailabilityResponses(updatedPoll.id);
    const [members, updatedByName] = await Promise.all([
      buildMembersField(updatedPoll, responses),
      resolveUpdatedByName(updatedPoll),
    ]);
    res.json({ ...buildPollPayload(updatedPoll, responses, userId, updatedByName), members });

    // Live update: notify connected watchers the poll's range changed.
    emitPollUpdate(updatedPoll.id);

    // Only fire push notifications when the date range (days or slots) actually
    // changed — title-only patches don't require members to re-enter their times.
    const newDays = updatedPoll.days as string[];
    const newSlots = updatedPoll.slots as string[];
    const rangeChanged =
      newDays.length !== prevDays.length ||
      newSlots.length !== prevSlots.length ||
      newDays.some((d, i) => d !== prevDays[i]) ||
      newSlots.some((s, i) => s !== prevSlots[i]);

    if (!rangeChanged) {
      // No grid change — nothing for members to act on.
      return;
    }

    // Fire-and-forget: push notifications to participants who haven't re-submitted
    // since the range was updated. We respond first so the host isn't blocked.
    void (async () => {
      try {
        const pollUpdatedAt = updatedPoll.updatedAt ?? new Date();

        // Gather all participant user IDs for this poll scope.
        const participantIds = new Set<string>();
        if (poll.squadId) {
          const squad = await storage.getSquad(poll.squadId);
          for (const id of ((squad?.memberIds ?? []) as string[])) {
            participantIds.add(id);
          }
        }
        if (poll.eventId) {
          const event = await storage.getEvent(poll.eventId);
          if (event) {
            participantIds.add(event.hostId);
            for (const id of Object.keys(event.rsvps ?? {})) {
              participantIds.add(id);
            }
            if (event.squadId) {
              const squad = await storage.getSquad(event.squadId);
              for (const id of ((squad?.memberIds ?? []) as string[])) {
                participantIds.add(id);
              }
            }
          }
        }
        // Also include anyone who has responded (they're participants even if not
        // currently in the squad/event member list).
        for (const r of responses) participantIds.add(r.userId);

        // Exclude the host who just made the change.
        participantIds.delete(userId);

        // Exclude members who already re-submitted AFTER this update.
        const responseMap = new Map(responses.map((r) => [r.userId, r]));
        const needsNudge = [...participantIds].filter((id) => {
          const resp = responseMap.get(id);
          if (!resp) return true; // never responded → nudge
          return new Date(resp.updatedAt) < pollUpdatedAt; // responded before update → nudge
        });

        if (needsNudge.length === 0) return;

        const tokens = await storage.getPushTokensForUsers(needsNudge, { requireNotifyReminders: true });
        const scopeData: Record<string, string> = poll.squadId
          ? { screen: "availability", squadId: poll.squadId }
          : { screen: "availability", eventId: poll.eventId ?? "" };

        await sendPushNotifications(
          tokens,
          {
            title: "Availability poll updated",
            body: "The availability poll has been updated — re-enter your times",
            data: scopeData,
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending poll-update push notifications");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error updating availability poll");
    res.status(500).json({ error: "Failed to update poll" });
  }
});

/**
 * POST /api/availability/polls/:id/nudge
 * Send a nudge notification to a pending member. Only the poll creator may call
 * this. Enforces a 5-minute debounce per (sender, target) to prevent spam.
 */
router.post("/availability/polls/:id/nudge", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const pollId = parseId(req.params.id);

    const poll = await storage.getAvailabilityPoll(pollId);
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (poll.createdBy !== userId) {
      res.status(403).json({ error: "Only the poll creator can send nudges" });
      return;
    }

    const parsed = NudgeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { targetUserId } = parsed.data;

    if (targetUserId === userId) {
      res.status(400).json({ error: "Cannot nudge yourself" });
      return;
    }

    // Verify the target is actually a pending member (hasn't responded yet).
    const responses = await storage.getAvailabilityResponses(pollId);
    const respondentIds = new Set(responses.map((r) => r.userId));
    if (respondentIds.has(targetUserId)) {
      res.status(400).json({ error: "This member has already responded" });
      return;
    }

    // Verify the target is actually a participant in this poll's scope. Without
    // this, the poll creator could push-spam any arbitrary userId by passing it
    // here — the only prior gate was "hasn't responded", which every non-member
    // trivially satisfies.
    const participantIds = new Set<string>();
    if (poll.squadId) {
      const squad = await storage.getSquad(poll.squadId);
      for (const pid of (squad?.memberIds ?? []) as string[]) participantIds.add(pid);
    }
    if (poll.eventId) {
      const event = await storage.getEvent(poll.eventId);
      if (event) {
        participantIds.add(event.hostId);
        for (const pid of Object.keys(event.rsvps ?? {})) participantIds.add(pid);
        if (event.squadId) {
          const squad = await storage.getSquad(event.squadId);
          for (const pid of (squad?.memberIds ?? []) as string[]) participantIds.add(pid);
        }
      }
    }
    if (!participantIds.has(targetUserId)) {
      res.status(403).json({ error: "You can only nudge members of this poll." });
      return;
    }

    // Debounce: reject if a nudge was already sent recently.
    const recent = await storage.getRecentNudge(pollId, userId, targetUserId, NUDGE_DEBOUNCE_MS);
    if (recent) {
      const retryAfterMs = NUDGE_DEBOUNCE_MS - (Date.now() - recent.sentAt.getTime());
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      res.status(429).json({
        error: "Nudge sent too recently — please wait a few minutes before nudging again",
        retryAfterSec,
        debounced: true,
      });
      return;
    }

    await storage.createNudge(pollId, userId, targetUserId);

    // Look up the sender's name for a friendlier response message.
    const [sender] = await storage.getUsers([userId]);
    const senderName = sender ? toDisplayName(sender) : "Someone";

    res.json({ ok: true, debounced: false, message: `${senderName} nudged the member successfully` });

    // Live update: a nudge changes member nudge state watchers should reflect.
    emitPollUpdate(poll.id);

    // Fire-and-forget: send the push notification after responding to the host.
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([targetUserId], { requireNotifyReminders: true });
        if (tokens.length === 0) return;

        const scopeData: Record<string, string> = poll.squadId
          ? { screen: "availability", squadId: poll.squadId }
          : { screen: "availability", eventId: poll.eventId ?? "" };

        const senderUsers = await storage.getUsers([userId]);
        const senderDisplayName = senderUsers.length ? toDisplayName(senderUsers[0]) : "Your host";

        await sendPushNotifications(
          tokens,
          {
            title: "Fill in your availability 📅",
            body: `${senderDisplayName} is waiting for your times — add them now`,
            data: scopeData,
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending nudge push notification");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error sending availability nudge");
    res.status(500).json({ error: "Failed to send nudge" });
  }
});

/**
 * PUT /api/availability/polls/:id/me
 * Upsert the caller's available cells for a poll.
 */
router.put("/availability/polls/:id/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const poll = await storage.getAvailabilityPoll(parseId(req.params.id));
    if (!poll) {
      res.status(404).json({ error: "Poll not found" });
      return;
    }
    if (!(await storage.canAccessAvailabilityPoll(poll, userId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const parsed = UpsertResponseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Keep only cells that belong to the poll's grid.
    const validCells = new Set<string>();
    for (const day of poll.days) {
      for (const slot of poll.slots) validCells.add(`${day}-${slot}`);
    }
    const deduped = [...new Set(parsed.data.cells)];
    const cells = deduped.filter((c) => validCells.has(c));
    const droppedCount = deduped.length - cells.length;

    await storage.upsertAvailabilityResponse(poll.id, userId, cells, "manual");
    const responses = await storage.getAvailabilityResponses(poll.id);
    const [members, updatedByName] = await Promise.all([
      buildMembersField(poll, responses),
      resolveUpdatedByName(poll),
    ]);
    const isCreator = poll.createdBy === userId;
    const respondentIds = new Set(responses.map((r) => r.userId));
    const { members: enrichedMembers, nudgedAt } = await enrichWithNudgeData(
      poll.id, userId, isCreator, members, respondentIds,
    );
    res.json({ ...buildPollPayload(poll, responses, userId, updatedByName), members: enrichedMembers, nudgedAt, droppedCount });

    // Live update: a member submitted/updated their availability.
    emitPollUpdate(poll.id);

    // Fire-and-forget: push notification to the poll creator when a member
    // re-submits their availability after the host updated the date range.
    void (async () => {
      try {
        // Only notify when the host has actually changed the range.
        if (!poll.updatedAt) return;
        // Never notify the creator about their own submissions.
        if (userId === poll.createdBy) return;
        // Only notify when this submission is more recent than the poll update,
        // confirming the member is responding to the updated range.
        const myResponse = responses.find((r) => r.userId === userId);
        if (!myResponse || new Date(myResponse.updatedAt) <= poll.updatedAt) return;

        const tokens = await storage.getPushTokensForUsers([poll.createdBy], { requireNotifyReminders: true });
        if (tokens.length === 0) return;

        const memberUsers = await storage.getUsers([userId]);
        const memberName = memberUsers.length > 0 ? toDisplayName(memberUsers[0]) : "A member";

        const scopeData: Record<string, string> = poll.squadId
          ? { screen: "availability", squadId: poll.squadId }
          : { screen: "availability", eventId: poll.eventId ?? "" };

        await sendPushNotifications(
          tokens,
          {
            title: "Availability updated",
            body: `${memberName} re-submitted their availability`,
            data: scopeData,
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending poll-response push notification to host");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error saving availability response");
    res.status(500).json({ error: "Failed to save availability" });
  }
});

export default router;
