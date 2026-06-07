import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, squadsTable, eventsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type SuggestionAction =
  | { kind: "create-squad" }
  | { kind: "create-event"; squadId?: string; squadName?: string; prefillTitle?: string; prefillEmoji?: string }
  | { kind: "open-event"; eventId: string };

type Suggestion = {
  id: string;
  emoji: string;
  title: string;
  why: string;
  type: string;
  action: SuggestionAction;
};

const MAX_SUGGESTIONS = 4;

/**
 * GET /api/suggestions
 *
 * Honest, data-driven prompts derived from the authenticated user's real
 * squads and events. Never fabricated — if there's nothing useful to suggest,
 * returns an empty array and the client hides the section.
 *
 *  - No squads yet            -> "Create your first squad"
 *  - A squad with no plans     -> "Plan something with <squad>"
 *  - An event you haven't RSVP'd to -> "RSVP to <event>"
 */
router.get("/suggestions", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    const squads = await db
      .select()
      .from(squadsTable)
      .where(sql`${squadsTable.memberIds} @> ${JSON.stringify([userId])}::jsonb`);

    const suggestions: Suggestion[] = [];

    if (squads.length === 0) {
      suggestions.push({
        id: "create-first-squad",
        emoji: "👥",
        title: "Create your first squad",
        why: "Squads are how you plan with your people",
        type: "Squad",
        action: { kind: "create-squad" },
      });
      res.json(suggestions);
      return;
    }

    const squadIds = squads.map((s) => s.id);
    const events =
      squadIds.length > 0
        ? await db
            .select()
            .from(eventsTable)
            .where(and(inArray(eventsTable.squadId, squadIds), eq(eventsTable.cancelled, false)))
        : [];

    // Squads with no (non-cancelled) plans yet.
    const squadIdsWithEvents = new Set(events.map((e) => e.squadId));
    for (const squad of squads) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (!squadIdsWithEvents.has(squad.id)) {
        suggestions.push({
          id: `plan-${squad.id}`,
          emoji: squad.emoji || "🗓️",
          title: `Plan something with ${squad.name}`,
          why: "No plans yet — get the squad together",
          type: "Plan",
          action: { kind: "create-event", squadId: squad.id, squadName: squad.name },
        });
      }
    }

    // Events you're invited to (squad plans) but haven't responded to.
    for (const event of events) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (event.hostId === userId) continue;
      const rsvps = (event.rsvps ?? {}) as Record<string, string>;
      if (userId in rsvps) continue;
      suggestions.push({
        id: `rsvp-${event.id}`,
        emoji: event.emoji || "🎉",
        title: `RSVP to ${event.title}`,
        why: `${event.squadName} · ${event.date}`,
        type: "RSVP",
        action: { kind: "open-event", eventId: event.id },
      });
    }

    res.json(suggestions.slice(0, MAX_SUGGESTIONS));
  } catch (err) {
    logger.error({ err }, "Error computing suggestions");
    res.status(500).json({ error: "Failed to compute suggestions" });
  }
});

export default router;
