import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";
import { sendPushNotifications } from "../lib/pushNotifications";
import { emitConversationUpdate, onConversationUpdate } from "../lib/conversationUpdates";
import { getBlockedAndBlockerIds } from "./moderation";

function displayName(user: { firstName?: string | null; lastName?: string | null; email?: string | null } | null | undefined): string {
  if (!user) return "Someone";
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email?.split("@")[0] ?? "Someone";
}

const router: IRouter = Router();

function parseId(raw: unknown): string {
  return Array.isArray(raw) ? (raw[0] as string) : (raw as string);
}

const AttachmentSchema = z.object({
  kind: z.enum(["image", "video"]),
  url: z.string().min(1),
  width: z.number().optional(),
  height: z.number().optional(),
});

const SendMessageBody = z
  .object({
    text: z.string().default(""),
    attachments: z.array(AttachmentSchema).default([]),
  })
  .refine((d) => d.text.trim().length > 0 || d.attachments.length > 0, {
    message: "Message must have text or at least one attachment",
  });

const StartDirectBody = z.object({
  userId: z.string().min(1),
});

// GET /conversations — every conversation the user can see (DMs + squad chats),
// enriched and ordered by most recent activity.
router.get("/conversations", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const [conversations, blockedIds] = await Promise.all([
      storage.listConversationsForUser(userId),
      getBlockedAndBlockerIds(userId),
    ]);
    const blockedSet = new Set(blockedIds);
    const visible = conversations.filter(
      (c) => c.type !== "direct" || !c.otherUserId || !blockedSet.has(c.otherUserId),
    );
    res.json(visible);
  } catch (err) {
    logger.error({ err }, "Error listing conversations");
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

// GET /conversations/unread-count — total unread across all conversations (tab badge).
router.get(
  "/conversations/unread-count",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req.user as { id: string }).id;
      const total = await storage.getTotalUnreadCount(userId);
      res.json({ count: total });
    } catch (err) {
      logger.error({ err }, "Error counting unread messages");
      res.status(500).json({ error: "Failed to count unread messages" });
    }
  },
);

// POST /conversations/direct — get-or-create a 1:1 DM with another user.
router.post(
  "/conversations/direct",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = StartDirectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = (req.user as { id: string }).id;
    const otherUserId = parsed.data.userId;
    if (otherUserId === userId) {
      res.status(400).json({ error: "Cannot start a conversation with yourself" });
      return;
    }
    try {
      const blockedIds = await getBlockedAndBlockerIds(userId);
      if (blockedIds.includes(otherUserId)) {
        res.status(403).json({ error: "Cannot message this user" });
        return;
      }
      const convo = await storage.getOrCreateDirectConversation(userId, otherUserId);
      res.status(201).json({ id: convo.id });
    } catch (err) {
      logger.error({ err }, "Error creating direct conversation");
      res.status(500).json({ error: "Failed to create conversation" });
    }
  },
);

// GET /conversations/squad/:squadId — get-or-create the squad's chat thread.
router.get(
  "/conversations/squad/:squadId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const squadId = parseId(req.params.squadId);
    const userId = (req.user as { id: string }).id;
    try {
      const convo = await storage.getOrCreateSquadConversation(squadId, userId);
      if (!convo) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      res.json({ id: convo.id });
    } catch (err) {
      logger.error({ err }, "Error opening squad conversation");
      res.status(500).json({ error: "Failed to open conversation" });
    }
  },
);

// GET /conversations/:id/messages — full thread + participants/read receipts.
router.get(
  "/conversations/:id/messages",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    try {
      const convo = await storage.getConversationForMember(id, userId);
      if (!convo) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      // Cursor pagination: ?before=<messageId> fetches the page of older
      // messages before that message; no cursor = latest page.
      const before = typeof req.query.before === "string" ? req.query.before : undefined;
      const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
      const limit = Number.isFinite(limitRaw) ? limitRaw : undefined;
      const [{ messages, hasMore }, participants] = await Promise.all([
        storage.getConversationMessages(id, { before, limit }),
        storage.getConversationParticipants(id),
      ]);

      res.json({
        conversation: {
          id: convo.id,
          type: convo.type,
          squadId: convo.squadId,
        },
        messages,
        participants,
        hasMore,
        nextCursor: hasMore && messages.length > 0 ? messages[0].id : null,
      });
    } catch (err) {
      logger.error({ err }, "Error fetching conversation messages");
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  },
);

// POST /conversations/:id/messages — send a message (text and/or attachments).
router.post(
  "/conversations/:id/messages",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    const parsed = SendMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const convo = await storage.getConversationForMember(id, userId);
      if (!convo) {
        res.status(403).json({ error: "Access denied" });
        return;
      }

      // Block check on EXISTING direct threads (mirrors the creation-time
      // check): if either party has blocked the other, sends are rejected.
      // Neutral copy — never reveal who blocked whom.
      if (convo.type === "direct") {
        const participants = await storage.getConversationParticipants(id);
        const otherIds = participants.map((p) => p.userId).filter((uid) => uid !== userId);
        const blockedIds = await getBlockedAndBlockerIds(userId);
        if (otherIds.some((uid) => blockedIds.includes(uid))) {
          res.status(403).json({ error: "You can't message this person" });
          return;
        }
      }

      // Provenance: only attach media you uploaded. The attachment ACL authorizes
      // the message sender to read the bytes, so without this a user could point
      // an attachment at another user's private object path and self-authorize
      // access. Public uploads (full https URLs) carry no private path to forge.
      for (const att of parsed.data.attachments) {
        if (/^https?:\/\//i.test(att.url)) continue;
        const owner = await storage.getUploadOwner(att.url);
        if (owner !== userId) {
          res.status(403).json({ error: "You can only attach media you uploaded." });
          return;
        }
      }

      const message = await storage.addConversationMessage(
        id,
        userId,
        parsed.data.text.trim(),
        parsed.data.attachments,
      );
      res.status(201).json(message);
      emitConversationUpdate(id);

      // Fire-and-forget: notify the other participants of the new message.
      void (async () => {
        try {
          const participants = await storage.getConversationParticipants(id);
          let recipientIds = participants
            .map((p) => p.userId)
            .filter((uid) => uid !== userId);
          // For squad threads, respect per-squad mute on top of the message pref.
          if (convo.type === "squad" && convo.squadId) {
            recipientIds = await storage.filterUnmutedForSquad(recipientIds, convo.squadId);
          }
          if (recipientIds.length === 0) return;

          const sender = await storage.getUser(userId);
          const senderName = displayName(sender);
          const preview = parsed.data.text.trim()
            ? parsed.data.text.trim()
            : parsed.data.attachments.some((a) => a.kind === "video")
              ? "📹 Video"
              : "📷 Photo";

          const onStaleToken = (token: string) => storage.clearPushToken(token);
          const data = { screen: "conversation", conversationId: id };

          const tokens = await storage.getPushTokensForUsers(recipientIds, {
            requireNotifyMessages: true,
          });
          if (tokens.length === 0) return;

          await sendPushNotifications(
            tokens,
            {
              title: senderName,
              body: preview.slice(0, 140),
              data,
            },
            { onStaleToken },
          );
        } catch (err) {
          logger.error({ err }, "Error sending message push notifications");
        }
      })();
    } catch (err) {
      logger.error({ err }, "Error sending message");
      res.status(500).json({ error: "Failed to send message" });
    }
  },
);

// GET /conversations/:id/stream — SSE endpoint for real-time conversation updates.
// Participants connect while the conversation screen is focused. Any new message
// sent via POST /conversations/:id/messages calls emitConversationUpdate(id)
// which pushes an "update" event to all connected watchers immediately.
router.get(
  "/conversations/:id/stream",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;

    // Verify membership before opening the stream.
    const convo = await storage.getConversationForMember(id, userId);
    if (!convo) {
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

    const unsubscribe = onConversationUpdate(id, () => {
      res.write(`event: update\ndata: {"conversationId":"${id}"}\n\n`);
    });

    // Keep-alive heartbeat every 25 s to prevent proxy/mobile connection timeouts.
    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  },
);

// POST /conversations/:id/read — mark the conversation read up to now.
router.post(
  "/conversations/:id/read",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    const userId = (req.user as { id: string }).id;
    try {
      const convo = await storage.getConversationForMember(id, userId);
      if (!convo) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      await storage.markConversationRead(id, userId);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "Error marking conversation read");
      res.status(500).json({ error: "Failed to mark read" });
    }
  },
);

export default router;
