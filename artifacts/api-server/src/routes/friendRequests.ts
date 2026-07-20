import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  friendshipsTable,
  friendRequestsTable,
  userBlocksTable,
  activityTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { sendPushNotifications } from "../lib/pushNotifications";
import { recordActivitySafe } from "../lib/activity";
import { emitActivityUpdate } from "../lib/activityEvents";

const router: IRouter = Router();

function displayName(
  user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined,
): string {
  if (!user) return "Someone";
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email?.split("@")[0] ?? "Someone";
}

const sendRequestSchema = z.object({ toUserId: z.string().min(1) });

// POST /api/users/friend-requests — send a friend request
router.post(
  "/users/friend-requests",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const parsed = sendRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "toUserId is required" });
        return;
      }
      const { toUserId } = parsed.data;
      if (toUserId === userId) {
        res.status(400).json({ error: "You can't send a friend request to yourself." });
        return;
      }

      // Check target user exists
      const [target] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, toUserId));
      if (!target) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Check not already friends
      const [existing] = await db
        .select({ id: friendshipsTable.id })
        .from(friendshipsTable)
        .where(
          and(eq(friendshipsTable.ownerId, userId), eq(friendshipsTable.friendId, toUserId)),
        );
      if (existing) {
        res.status(409).json({ error: "Already friends" });
        return;
      }

      // Block check: reject if either party has blocked the other
      const [blockRow] = await db
        .select({ id: userBlocksTable.id })
        .from(userBlocksTable)
        .where(
          or(
            and(eq(userBlocksTable.blockerId, userId), eq(userBlocksTable.blockedId, toUserId)),
            and(eq(userBlocksTable.blockerId, toUserId), eq(userBlocksTable.blockedId, userId)),
          ),
        )
        .limit(1);
      if (blockRow) {
        res.status(403).json({ error: "Cannot send a friend request to this user" });
        return;
      }

      // Check for pending request in either direction
      const [pendingRequest] = await db
        .select({ id: friendRequestsTable.id, fromUserId: friendRequestsTable.fromUserId })
        .from(friendRequestsTable)
        .where(
          and(
            or(
              and(
                eq(friendRequestsTable.fromUserId, userId),
                eq(friendRequestsTable.toUserId, toUserId),
              ),
              and(
                eq(friendRequestsTable.fromUserId, toUserId),
                eq(friendRequestsTable.toUserId, userId),
              ),
            ),
            eq(friendRequestsTable.status, "pending"),
          ),
        );

      // If they already sent us a request, auto-accept it
      if (pendingRequest && pendingRequest.fromUserId === toUserId) {
        await db
          .update(friendRequestsTable)
          .set({ status: "accepted" })
          .where(eq(friendRequestsTable.id, pendingRequest.id));
        await db
          .insert(friendshipsTable)
          .values([
            { ownerId: userId, friendId: toUserId },
            { ownerId: toUserId, friendId: userId },
          ])
          .onConflictDoNothing();
        // Clear the pending friend_request activity for both sides
        await db
          .delete(activityTable)
          .where(
            and(
              eq(activityTable.recipientId, userId),
              eq(activityTable.actorId, toUserId),
              eq(activityTable.type, "friend_request"),
            ),
          );
        emitActivityUpdate(userId);
        res.json({ ok: true, autoAccepted: true });
        return;
      }

      if (pendingRequest) {
        res.status(409).json({ error: "Friend request already sent" });
        return;
      }

      // Insert the request
      const [inserted] = await db
        .insert(friendRequestsTable)
        .values({ fromUserId: userId, toUserId, status: "pending" })
        .returning({ id: friendRequestsTable.id });

      if (!inserted) {
        res.status(500).json({ error: "Failed to create request" });
        return;
      }

      res.json({ ok: true, requestId: inserted.id });

      // Record activity — subjectId = request ID so the client can accept/decline
      recordActivitySafe({
        recipientId: toUserId,
        actorId: userId,
        type: "friend_request",
        subjectType: "user",
        subjectId: inserted.id,
        dedupe: false,
      });

      // Push notification
      void (async () => {
        try {
          const tokens = await storage.getPushTokensForUsers([toUserId], {
            requireNotifyFriendActivity: true,
          });
          if (tokens.length === 0) return;
          const sender = await storage.getUser(userId);
          await sendPushNotifications(
            tokens,
            {
              title: "Friend request",
              body: `${displayName(sender)} wants to be your friend`,
              data: { screen: "activity" },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending friend-request push notification");
        }
      })();
    } catch (err) {
      logger.error({ err }, "Error sending friend request");
      res.status(500).json({ error: "Failed to send friend request" });
    }
  },
);

// GET /api/users/friend-requests/sent — list pending outgoing request toUserIds
router.get(
  "/users/friend-requests/sent",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const rows = await db
        .select({ toUserId: friendRequestsTable.toUserId })
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.fromUserId, userId),
            eq(friendRequestsTable.status, "pending"),
          ),
        );
      res.json(rows.map((r) => r.toUserId));
    } catch (err) {
      logger.error({ err }, "Error listing sent friend requests");
      res.status(500).json({ error: "Failed to list sent requests" });
    }
  },
);

// POST /api/users/friend-requests/:id/accept — accept a pending request
router.post(
  "/users/friend-requests/:id/accept",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const requestId = String(req.params.id);

      const [request] = await db
        .select()
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.id, requestId),
            eq(friendRequestsTable.toUserId, userId),
            eq(friendRequestsTable.status, "pending"),
          ),
        );
      if (!request) {
        res.status(404).json({ error: "Friend request not found" });
        return;
      }

      // Mark accepted
      await db
        .update(friendRequestsTable)
        .set({ status: "accepted" })
        .where(eq(friendRequestsTable.id, requestId));

      // Create mutual friendship
      await db
        .insert(friendshipsTable)
        .values([
          { ownerId: userId, friendId: request.fromUserId },
          { ownerId: request.fromUserId, friendId: userId },
        ])
        .onConflictDoNothing();

      // Remove the friend_request activity row from recipient's feed
      await db
        .delete(activityTable)
        .where(
          and(
            eq(activityTable.recipientId, userId),
            eq(activityTable.actorId, request.fromUserId),
            eq(activityTable.type, "friend_request"),
          ),
        );
      emitActivityUpdate(userId);

      res.json({ ok: true });

      // Notify the sender that their request was accepted
      recordActivitySafe({
        recipientId: request.fromUserId,
        actorId: userId,
        type: "friend_added",
        subjectType: "user",
        subjectId: userId,
      });

      void (async () => {
        try {
          const tokens = await storage.getPushTokensForUsers([request.fromUserId], {
            requireNotifyFriendActivity: true,
          });
          if (tokens.length === 0) return;
          const accepter = await storage.getUser(userId);
          await sendPushNotifications(
            tokens,
            {
              title: "Friend request accepted",
              body: `${displayName(accepter)} accepted your friend request`,
              data: { screen: "friends" },
            },
            { onStaleToken: (token) => storage.clearPushToken(token) },
          );
        } catch (err) {
          logger.error({ err }, "Error sending friend-request-accepted push");
        }
      })();
    } catch (err) {
      logger.error({ err }, "Error accepting friend request");
      res.status(500).json({ error: "Failed to accept friend request" });
    }
  },
);

// POST /api/users/friend-requests/:id/decline — decline a pending request
router.post(
  "/users/friend-requests/:id/decline",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const requestId = String(req.params.id);

      const [request] = await db
        .select()
        .from(friendRequestsTable)
        .where(
          and(
            eq(friendRequestsTable.id, requestId),
            eq(friendRequestsTable.toUserId, userId),
            eq(friendRequestsTable.status, "pending"),
          ),
        );
      if (!request) {
        res.status(404).json({ error: "Friend request not found" });
        return;
      }

      await db
        .update(friendRequestsTable)
        .set({ status: "declined" })
        .where(eq(friendRequestsTable.id, requestId));

      // Remove the activity row
      await db
        .delete(activityTable)
        .where(
          and(
            eq(activityTable.recipientId, userId),
            eq(activityTable.actorId, request.fromUserId),
            eq(activityTable.type, "friend_request"),
          ),
        );
      emitActivityUpdate(userId);

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Error declining friend request");
      res.status(500).json({ error: "Failed to decline friend request" });
    }
  },
);

export default router;
