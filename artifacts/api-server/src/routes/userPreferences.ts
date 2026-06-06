import { Router, type IRouter, type Request, type Response } from "express";
import { eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable, eventsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { randomUUID } from "crypto";

const router: IRouter = Router();

const PatchPreferencesBody = z.object({
  calendarSyncEnabled: z.boolean().optional(),
});

router.get("/user/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const [user] = await db.select({
      calendarSyncEnabled: usersTable.calendarSyncEnabled,
      calendarToken: usersTable.calendarToken,
    }).from(usersTable).where(eq(usersTable.id, userId));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      calendarSyncEnabled: user.calendarSyncEnabled,
      calendarToken: user.calendarToken,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching user preferences");
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

router.patch("/user/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = PatchPreferencesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const userId = (req.user as { id: string }).id;
    const patch: Partial<typeof usersTable.$inferInsert> = {};

    if (parsed.data.calendarSyncEnabled !== undefined) {
      patch.calendarSyncEnabled = parsed.data.calendarSyncEnabled;

      if (parsed.data.calendarSyncEnabled) {
        const [existing] = await db.select({ calendarToken: usersTable.calendarToken })
          .from(usersTable)
          .where(eq(usersTable.id, userId));
        if (!existing?.calendarToken) {
          patch.calendarToken = randomUUID();
        }
      }
    }

    const [updated] = await db.update(usersTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({
        calendarSyncEnabled: usersTable.calendarSyncEnabled,
        calendarToken: usersTable.calendarToken,
      });

    res.json({
      calendarSyncEnabled: updated.calendarSyncEnabled,
      calendarToken: updated.calendarToken,
    });
  } catch (err) {
    logger.error({ err }, "Error updating user preferences");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

function formatIcsDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const today = new Date();
    return today.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  }
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function escapeIcs(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildIcs(events: Array<{ id: string; title: string; date: string; location: string; description: string; emoji: string }>): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Squadz//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Squadz Events",
    "X-WR-TIMEZONE:UTC",
  ];

  for (const event of events) {
    const dtStamp = formatIcsDate(new Date().toISOString());
    const dtStart = formatIcsDate(event.date);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@squadz`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`SUMMARY:${escapeIcs(`${event.emoji} ${event.title}`)}`);
    if (event.location && event.location !== "TBD") {
      lines.push(`LOCATION:${escapeIcs(event.location)}`);
    }
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

router.get("/calendar/ics/:token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params as { token: string };
    if (!token) {
      res.status(400).json({ error: "Missing token" });
      return;
    }

    const [user] = await db.select({ id: usersTable.id, calendarSyncEnabled: usersTable.calendarSyncEnabled })
      .from(usersTable)
      .where(eq(usersTable.calendarToken, token));

    if (!user || !user.calendarSyncEnabled) {
      res.status(404).send("Calendar not found or sync is disabled");
      return;
    }

    const events = await db.select({
      id: eventsTable.id,
      title: eventsTable.title,
      date: eventsTable.date,
      location: eventsTable.location,
      description: eventsTable.description,
      emoji: eventsTable.emoji,
    }).from(eventsTable).where(
      or(
        eq(eventsTable.hostId, user.id),
        sql`${eventsTable.rsvps} ? ${user.id}`,
      ),
    );

    const icsContent = buildIcs(events);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=squadz.ics");
    res.send(icsContent);
  } catch (err) {
    logger.error({ err }, "Error generating ICS feed");
    res.status(500).send("Failed to generate calendar");
  }
});

export default router;
