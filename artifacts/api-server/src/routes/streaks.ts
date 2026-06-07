import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Return the Monday of the week containing the given date (UTC). */
function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysBack = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysBack));
}

/**
 * Given a list of unique year-month Date objects (1st of each month, UTC),
 * sorted descending, return the length of the streak counting back from the
 * most recent month.  A streak is "active" only if the most recent month is
 * the current month or the immediately preceding month.
 */
function calcMonthlyStreak(months: Date[]): number {
  if (months.length === 0) return 0;

  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const mostRecent = months[0];
  if (mostRecent.getTime() < lastMonth.getTime()) return 0; // dead streak

  let streak = 1;
  for (let i = 1; i < months.length; i++) {
    const prev = months[i - 1];
    const expected = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() - 1, 1));
    if (months[i].getTime() === expected.getTime()) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Given a list of unique week-start (Monday) Date objects (UTC), sorted
 * descending, return the length of the streak counting back from the most
 * recent week.  A streak is "active" only if the most recent week is this
 * week or last week.
 */
function calcWeeklyStreak(weeks: Date[]): number {
  if (weeks.length === 0) return 0;

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = mondayOf(new Date());
  const lastWeek = new Date(thisWeek.getTime() - WEEK_MS);

  const mostRecent = weeks[0];
  if (mostRecent.getTime() < lastWeek.getTime()) return 0; // dead streak

  let streak = 1;
  for (let i = 1; i < weeks.length; i++) {
    const expected = new Date(weeks[i - 1].getTime() - WEEK_MS);
    if (weeks[i].getTime() === expected.getTime()) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * GET /api/streaks
 *
 * Returns two live streak counts for the authenticated user:
 *  - monthlyPlan: consecutive calendar months with ≥1 event hosted or attended
 *  - stayInTouch: consecutive calendar weeks with ≥1 message sent OR event joined
 */
router.get("/api/streaks", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;

  try {
    // Monthly plan streak — distinct months of event participation
    const monthRows = await db.execute<{ month: string }>(sql`
      SELECT DISTINCT
        TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-01') AS month
      FROM events
      WHERE (host_id = ${userId} OR rsvps ? ${userId})
        AND cancelled = false
      ORDER BY month DESC
      LIMIT 36
    `);

    const eventMonths = monthRows.rows.map((r) => new Date(r.month));

    // Stay-in-touch streak — distinct weeks with any activity (message or event)
    const weekRows = await db.execute<{ week: string }>(sql`
      SELECT DISTINCT
        TO_CHAR(
          DATE_TRUNC('week', ts AT TIME ZONE 'UTC'),
          'YYYY-MM-DD'
        ) AS week
      FROM (
        SELECT created_at AS ts
        FROM conversation_messages
        WHERE sender_id = ${userId}
        UNION ALL
        SELECT created_at AS ts
        FROM events
        WHERE (host_id = ${userId} OR rsvps ? ${userId})
          AND cancelled = false
      ) sub
      ORDER BY week DESC
      LIMIT 104
    `);

    const touchWeeks = weekRows.rows.map((r) => new Date(r.week));

    res.json({
      monthlyPlan: calcMonthlyStreak(eventMonths),
      stayInTouch: calcWeeklyStreak(touchWeeks),
    });
  } catch (err) {
    logger.error({ err }, "Error computing streaks");
    res.status(500).json({ error: "Failed to compute streaks" });
  }
});

export default router;
