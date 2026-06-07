import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import type { AvailabilityPoll } from "@workspace/db/schema";

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const CreatePollBody = z
  .object({
    squadId: z.string().optional(),
    eventId: z.string().optional(),
    title: z.string().max(120).optional(),
    days: z.array(z.string().max(20)).max(14).optional(),
    slots: z.array(z.string().max(20)).max(48).optional(),
  })
  .refine((d) => d.squadId || d.eventId, {
    message: "A poll must be scoped to a squad or an event",
  });

const FindPollQuery = z
  .object({
    squadId: z.string().optional(),
    eventId: z.string().optional(),
  })
  .refine((d) => d.squadId || d.eventId, {
    message: "squadId or eventId is required",
  });

const UpsertResponseBody = z.object({
  cells: z.array(z.string().max(40)).max(672),
});

type AggregatedCell = { cell: string; count: number };

function buildPollPayload(
  poll: AvailabilityPoll,
  responses: { userId: string; cells: string[] }[],
  userId: string,
) {
  const counts = new Map<string, number>();
  for (const r of responses) {
    for (const cell of r.cells) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
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
    },
    heatmap,
    respondentCount,
    myCells: myResponse?.cells ?? [],
    best:
      bestCell && bestCount > 0
        ? { cell: bestCell, count: bestCount, total: respondentCount }
        : null,
  };
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
    const { squadId, eventId, title, days, slots } = parsed.data;

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

    // Reuse an existing poll for the same scope rather than creating duplicates.
    const existing = await storage.findAvailabilityPoll({ squadId, eventId });
    const poll =
      existing ??
      (await storage.createAvailabilityPoll({
        createdBy: userId,
        squadId: squadId ?? null,
        eventId: eventId ?? null,
        title,
        days,
        slots,
      }));

    const responses = await storage.getAvailabilityResponses(poll.id);
    res.status(existing ? 200 : 201).json(buildPollPayload(poll, responses, userId));
  } catch (err) {
    logger.error({ err }, "Error creating availability poll");
    res.status(500).json({ error: "Failed to create poll" });
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
    res.json(buildPollPayload(poll, responses, userId));
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
    res.json(buildPollPayload(poll, responses, userId));
  } catch (err) {
    logger.error({ err }, "Error fetching availability poll");
    res.status(500).json({ error: "Failed to fetch poll" });
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
    const cells = [...new Set(parsed.data.cells)].filter((c) => validCells.has(c));

    await storage.upsertAvailabilityResponse(poll.id, userId, cells, "manual");
    const responses = await storage.getAvailabilityResponses(poll.id);
    res.json(buildPollPayload(poll, responses, userId));
  } catch (err) {
    logger.error({ err }, "Error saving availability response");
    res.status(500).json({ error: "Failed to save availability" });
  }
});

export default router;
