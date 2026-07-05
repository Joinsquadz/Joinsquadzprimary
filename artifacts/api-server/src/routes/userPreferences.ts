import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Calendar Sync was removed in favor of per-plan "Add to calendar" (.ics
// export on the client). Stale clients that still PATCH calendarSyncEnabled
// are safe: this schema is non-strict, so unknown keys are stripped, not 400d.
const PatchPreferencesBody = z.object({
  notifyEventInvites: z.boolean().optional(),
  notifyReminders: z.boolean().optional(),
  notifyMessages: z.boolean().optional(),
  notifyFriendActivity: z.boolean().optional(),
  notifySquadJoin: z.boolean().optional(),
  notifySquadLeave: z.boolean().optional(),
  notifyPayments: z.boolean().optional(),
  privateProfile: z.boolean().optional(),
  showRsvpActivity: z.boolean().optional(),
});

const PREF_FIELDS = [
  "notifyEventInvites",
  "notifyReminders",
  "notifyMessages",
  "notifyFriendActivity",
  "notifySquadJoin",
  "notifySquadLeave",
  "notifyPayments",
  "privateProfile",
  "showRsvpActivity",
] as const;

/**
 * Normalize a user-entered payment handle: trim, strip a leading "@", and if a
 * full profile URL was pasted (venmo.com/u/foo, cash.app/$foo), reduce it to the
 * bare username. An empty result becomes null (handle cleared). Zelle handles
 * are usually an email/phone, so we only trim + strip a stray leading "@".
 */
function normalizeHandle(raw: string): string | null {
  let h = raw.trim();
  if (!h) return null;
  const urlMatch = h.match(/^(?:https?:\/\/)?(?:www\.)?(?:venmo\.com\/(?:u\/)?|account\.venmo\.com\/u\/|cash\.app\/)(.+)$/i);
  if (urlMatch) h = urlMatch[1];
  h = h.replace(/^[@$]+/, "").replace(/\/+$/, "").trim();
  return h || null;
}

const HANDLE_FIELDS = ["venmoHandle", "cashappHandle", "zelleHandle"] as const;

const PatchProfileBody = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().max(60).nullable().optional(),
  profileImageUrl: z.string().trim().max(2048).nullable().optional(),
  venmoHandle: z.string().trim().max(120).nullable().optional(),
  cashappHandle: z.string().trim().max(120).nullable().optional(),
  zelleHandle: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  hometown: z.string().trim().max(100).nullable().optional(),
});

router.get("/user/preferences", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const [user] = await db.select({
      notifyEventInvites: usersTable.notifyEventInvites,
      notifyReminders: usersTable.notifyReminders,
      notifyMessages: usersTable.notifyMessages,
      notifyFriendActivity: usersTable.notifyFriendActivity,
      notifySquadJoin: usersTable.notifySquadJoin,
      notifySquadLeave: usersTable.notifySquadLeave,
      notifyPayments: usersTable.notifyPayments,
      privateProfile: usersTable.privateProfile,
      showRsvpActivity: usersTable.showRsvpActivity,
      venmoHandle: usersTable.venmoHandle,
      cashappHandle: usersTable.cashappHandle,
      zelleHandle: usersTable.zelleHandle,
      bio: usersTable.bio,
      hometown: usersTable.hometown,
    }).from(usersTable).where(eq(usersTable.id, userId));

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(user);
  } catch (err) {
    logger.error({ err }, "Error fetching user preferences");
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

router.patch("/user/profile", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = PatchProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const userId = (req.user as { id: string }).id;
    const patch: Partial<typeof usersTable.$inferInsert> = {};
    if (parsed.data.firstName !== undefined) patch.firstName = parsed.data.firstName;
    if (parsed.data.lastName !== undefined) patch.lastName = parsed.data.lastName;
    if (parsed.data.profileImageUrl !== undefined) patch.profileImageUrl = parsed.data.profileImageUrl;
    if (parsed.data.bio !== undefined) patch.bio = parsed.data.bio;
    if (parsed.data.hometown !== undefined) patch.hometown = parsed.data.hometown;
    for (const field of HANDLE_FIELDS) {
      const value = parsed.data[field];
      if (value !== undefined) patch[field] = value === null ? null : normalizeHandle(value);
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const [updated] = await db.update(usersTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        venmoHandle: usersTable.venmoHandle,
        cashappHandle: usersTable.cashappHandle,
        zelleHandle: usersTable.zelleHandle,
        bio: usersTable.bio,
        hometown: usersTable.hometown,
      });

    res.json({ user: updated });
  } catch (err) {
    logger.error({ err }, "Error updating profile");
    res.status(500).json({ error: "Failed to update profile" });
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

    for (const field of PREF_FIELDS) {
      const value = parsed.data[field];
      if (value !== undefined) patch[field] = value;
    }

    const [updated] = await db.update(usersTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(usersTable.id, userId))
      .returning({
        notifyEventInvites: usersTable.notifyEventInvites,
        notifyReminders: usersTable.notifyReminders,
        notifyMessages: usersTable.notifyMessages,
        notifyFriendActivity: usersTable.notifyFriendActivity,
        notifySquadJoin: usersTable.notifySquadJoin,
        notifySquadLeave: usersTable.notifySquadLeave,
        notifyPayments: usersTable.notifyPayments,
        privateProfile: usersTable.privateProfile,
        showRsvpActivity: usersTable.showRsvpActivity,
      });

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Error updating user preferences");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

export default router;
