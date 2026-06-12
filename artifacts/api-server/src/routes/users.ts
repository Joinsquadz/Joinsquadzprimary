import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable, friendshipsTable, squadsTable } from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { sendPushNotifications } from "../lib/pushNotifications";
import { resolveProStatus } from "../lib/proStatus";
import { recordActivitySafe } from "../lib/activity";

const router: IRouter = Router();

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return "Someone";
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email?.split("@")[0] ?? "Someone";
}

const MAX_IDS = 100;

router.get("/users/by-friend-code/:code", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const code = (req.params.code as string).toUpperCase().trim();
    if (!code) {
      res.status(400).json({ error: "code is required" });
      return;
    }
    const [user] = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(eq(usersTable.friendCode, code));
    if (!user) {
      res.status(404).json({ error: "No user found with that friend code." });
      return;
    }
    res.json(user);
  } catch (err) {
    logger.error({ err }, "Error looking up user by friend code");
    res.status(500).json({ error: "Failed to look up friend code" });
  }
});

router.get("/users", requireAuth, async (req, res) => {
  const rawIds = req.query.ids;
  if (!rawIds || typeof rawIds !== "string") {
    res.status(400).json({ error: "ids query param required (comma-separated)" });
    return;
  }

  const ids = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS);

  const parseResult = z.array(z.string().min(1)).safeParse(ids);
  if (!parseResult.success || ids.length === 0) {
    res.status(400).json({ error: "Invalid ids" });
    return;
  }

  const rows = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      profileImageUrl: usersTable.profileImageUrl,
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
      stripeCustomerId: usersTable.stripeCustomerId,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));

  // Resolve Pro status for the gold-ring badge. Free users (no Stripe linkage)
  // short-circuit to false without any subscription lookup, so the common case
  // stays cheap; only users with a subscription/customer id hit storage.
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const { stripeSubscriptionId, stripeCustomerId, ...pub } = row;
      const isPro = await resolveProStatus(row as never);
      return { ...pub, isPro };
    }),
  );

  res.json(enriched);
});

const SEARCH_LIMIT = 20;

router.get("/users/search", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q || q.length < 2) {
      res.status(400).json({ error: "q must be at least 2 characters" });
      return;
    }
    const currentUserId = (req.user as { id: string }).id;
    const pattern = `%${q}%`;
    const rows = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(
        sql`${usersTable.id} != ${currentUserId} AND (
          ${usersTable.firstName} ILIKE ${pattern} OR
          ${usersTable.lastName} ILIKE ${pattern} OR
          COALESCE(${usersTable.firstName}, '') || ' ' || COALESCE(${usersTable.lastName}, '') ILIKE ${pattern}
        )`
      )
      .limit(SEARCH_LIMIT);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "Error searching users");
    res.status(500).json({ error: "Failed to search users" });
  }
});

// --- Friends (persistent, symmetric) -------------------------------------

const addFriendSchema = z.object({ friendId: z.string().min(1) });

// List the authenticated user's friends as full user objects.
router.get("/users/friends", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const rows = await db
      .select({ friendId: friendshipsTable.friendId })
      .from(friendshipsTable)
      .where(eq(friendshipsTable.ownerId, userId));
    const ids = rows.map((r) => r.friendId);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    const users = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
      })
      .from(usersTable)
      .where(inArray(usersTable.id, ids));
    res.json(users);
  } catch (err) {
    logger.error({ err }, "Error listing friends");
    res.status(500).json({ error: "Failed to list friends" });
  }
});

// Add a friend. Writes both directions so the relationship is mutual.
// Idempotent thanks to the unique (owner_id, friend_id) constraint.
router.post("/users/friends", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = addFriendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "friendId is required" });
      return;
    }
    const { friendId } = parsed.data;
    if (friendId === userId) {
      res.status(400).json({ error: "You can't add yourself as a friend." });
      return;
    }
    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, friendId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db
      .insert(friendshipsTable)
      .values([
        { ownerId: userId, friendId },
        { ownerId: friendId, friendId: userId },
      ])
      .onConflictDoNothing();
    res.json({ ok: true });
    recordActivitySafe({
      recipientId: friendId,
      actorId: userId,
      type: "friend_added",
      subjectType: "user",
      subjectId: userId,
    });

    // Fire-and-forget: tell the new friend they were added.
    void (async () => {
      try {
        const tokens = await storage.getPushTokensForUsers([friendId], { requireNotifyFriendActivity: true });
        if (tokens.length === 0) return;
        const adder = await storage.getUser(userId);
        await sendPushNotifications(
          tokens,
          {
            title: "New friend",
            body: `${displayName(adder)} added you as a friend`,
            data: { screen: "friends" },
          },
          { onStaleToken: (token) => storage.clearPushToken(token) },
        );
      } catch (err) {
        logger.error({ err }, "Error sending friend-add push notification");
      }
    })();
  } catch (err) {
    logger.error({ err }, "Error adding friend");
    res.status(500).json({ error: "Failed to add friend" });
  }
});

// Remove a friend in both directions.
router.delete("/users/friends/:friendId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const otherId = (req.params.friendId as string).trim();
    if (!otherId) {
      res.status(400).json({ error: "friendId is required" });
      return;
    }
    await db
      .delete(friendshipsTable)
      .where(
        or(
          and(eq(friendshipsTable.ownerId, userId), eq(friendshipsTable.friendId, otherId)),
          and(eq(friendshipsTable.ownerId, otherId), eq(friendshipsTable.friendId, userId)),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error removing friend");
    res.status(500).json({ error: "Failed to remove friend" });
  }
});

router.get("/users/:id/profile", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const targetId = req.params.id as string;
  const requesterId = (req.user as { id: string }).id;
  try {
    const [target] = await db
      .select({
        id: usersTable.id,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        profileImageUrl: usersTable.profileImageUrl,
        friendCode: usersTable.friendCode,
        bio: usersTable.bio,
        hometown: usersTable.hometown,
      })
      .from(usersTable)
      .where(eq(usersTable.id, targetId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Squads where both the requester and the target are members.
    const [sharedSquads, fullTarget] = await Promise.all([
      db
        .select({ id: squadsTable.id, name: squadsTable.name, emoji: squadsTable.emoji, color: squadsTable.color })
        .from(squadsTable)
        .where(
          and(
            sql`${squadsTable.memberIds} @> ${JSON.stringify([requesterId])}::jsonb`,
            sql`${squadsTable.memberIds} @> ${JSON.stringify([targetId])}::jsonb`,
          ),
        ),
      storage.getUser(targetId),
    ]);
    const isPro = fullTarget ? await resolveProStatus(fullTarget) : false;
    const name = [target.firstName, target.lastName].filter(Boolean).join(" ") || "Unknown";
    res.json({
      id: target.id,
      name,
      friendCode: target.friendCode ?? null,
      profileImageUrl: target.profileImageUrl ?? null,
      bio: target.bio ?? null,
      hometown: target.hometown ?? null,
      isPro,
      sharedSquads,
    });
  } catch (err) {
    logger.error({ err }, "Error fetching user profile");
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;
