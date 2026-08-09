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

/**
 * Live gate for an EXISTING direct thread, applied to both reading and sending.
 *
 * Participant rows are append-only, so membership alone proves nothing: a DM is
 * only accessible while the two people are friends and neither has blocked the
 * other. Unfriending (or a block, which drops the friendship) closes the thread.
 * Returns a denial to send, or null when access is allowed.
 */
async function directThreadDenial(
  convoId: string,
  userId: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const reason = await storage.directThreadDenialReason(convoId, userId);
  // Neutral copy — never reveal who blocked whom.
  if (reason === "blocked") {
    return { status: 403, body: { error: "You can't message this person" } };
  }
  if (reason === "not_friends") {
    return {
      status: 403,
      body: {
        error: "You can only message your friends. Send a friend request first.",
        code: "NOT_FRIENDS",
      },
    };
  }
  return null;
}

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
    const notBlocked = conversations.filter(
      (c) => c.type !== "direct" || !c.otherUserId || !blockedSet.has(c.otherUserId),
    );
    // DMs are friends-only: hide direct threads with people who are not
    // currently friends (unfriended, or a block that dropped the friendship).
    // Squad conversations are membership-based and never filtered here.
    const friendChecks = await Promise.all(
      notBlocked.map((c) =>
        c.type === "direct" && c.otherUserId
          ? storage.areUsersFriends(userId, c.otherUserId)
          : Promise.resolve(true),
      ),
    );
    const visible = notBlocked.filter((_, i) => friendChecks[i]);
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
      // Private DMs are friends-only — sharing a squad is not enough. This is
      // the server-side gate; the UI hiding the button is not enforcement.
      const allowed = await storage.canInitiateDm(userId, otherUserId);
      if (!allowed) {
        res.status(403).json({
          error: "You can only message your friends. Send a friend request first.",
          code: "NOT_FRIENDS",
        });
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

// GET /conversations/event/:eventId — get-or-create the chat thread for a plan
// (event OR trip). Authorized by CURRENT plan visibility, not by a stale
// participant row, so a removed squadmate or uninvited guest gets a 403.
router.get(
  "/conversations/event/:eventId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const eventId = parseId(req.params.eventId);
    const userId = (req.user as { id: string }).id;
    try {
      const convo = await storage.getOrCreateEventConversation(eventId, userId);
      if (!convo) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
      res.json({ id: convo.id });
    } catch (err) {
      logger.error({ err }, "Error opening event conversation");
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
      // A DM is only readable while the two are friends and unblocked, so a
      // non-friend cannot open the thread via a direct API call.
      if (convo.type === "direct") {
        const denial = await directThreadDenial(id, userId);
        if (denial) {
          res.status(denial.status).json(denial.body);
          return;
        }
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
          eventId: convo.eventId,
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

      // Block + friendship check on EXISTING direct threads, mirroring the
      // creation-time gate so a stale participant row can't be used to send.
      if (convo.type === "direct") {
        const denial = await directThreadDenial(id, userId);
        if (denial) {
          res.status(denial.status).json(denial.body);
          return;
        }
      }

      // A cancelled plan is read-only: its chat closes with it (mirrors the
      // 410 the event sub-resource routes return for cancelled plans).
      if (convo.type === "event" && convo.eventId) {
        const event = await storage.getEvent(convo.eventId);
        if (!event) {
          res.status(404).json({ error: "Plan not found" });
          return;
        }
        if (event.cancelled) {
          res.status(410).json({ error: "This plan was cancelled — chat is closed" });
          return;
        }
        // Re-derive the audience so a squadmate added after the thread was
        // created still gets the push and sees the thread in their inbox.
        await storage.syncEventConversationParticipants(convo.id, convo.eventId);
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

          // Plan threads: drop anyone who has since lost access to the plan
          // (participant rows are append-only), and honour the mute on the
          // squad the plan belongs to.
          let planEvent: Awaited<ReturnType<typeof storage.getEvent>> | null = null;
          if (convo.type === "event" && convo.eventId) {
            planEvent = await storage.getEvent(convo.eventId);
            if (!planEvent) return;
            const stillVisible = await Promise.all(
              recipientIds.map((uid) => storage.canUserAccessEventRecord(planEvent!, uid)),
            );
            recipientIds = recipientIds.filter((_, i) => stillVisible[i]);
            if (planEvent.squadId) {
              recipientIds = await storage.filterUnmutedForSquad(recipientIds, planEvent.squadId);
            }
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
          // Plan chats live inside the event/trip detail screen, so their taps
          // must route there (with the chat tab selected), not to the generic
          // conversation screen. See the push-tap routing contract.
          const data =
            planEvent != null
              ? {
                  screen: planEvent.type === "trip" ? "trip" : "event",
                  eventId: planEvent.id,
                  tab: "chat",
                }
              : { screen: "conversation", conversationId: id };

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
    // A stream is a live read of the thread, so it needs the same friends-only
    // gate as reading it — otherwise an unfriended/blocked participant keeps a
    // long-lived subscription to a thread they can no longer open.
    if (convo.type === "direct") {
      const denial = await directThreadDenial(id, userId);
      if (denial) {
        res.status(denial.status).json(denial.body);
        return;
      }
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

    let closed = false;
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const closeStream = (): void => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };

    /**
     * Authorization at connect time is not enough: this socket outlives the
     * check. An unfriend or block mid-stream must stop delivery immediately —
     * even the bare "a message happened" ping is activity disclosure — so the
     * gate is re-run before every push and on each heartbeat, and the stream is
     * torn down the moment it closes.
     */
    const stillAllowed = async (): Promise<boolean> => {
      if (convo.type !== "direct") return true;
      try {
        return (await storage.directThreadDenialReason(id, userId)) === null;
      } catch (err) {
        // Fail closed: an unverifiable thread is not a readable thread.
        logger.error({ err, conversationId: id }, "Error revalidating DM stream access");
        return false;
      }
    };

    unsubscribe = onConversationUpdate(id, () => {
      void (async () => {
        if (closed) return;
        if (!(await stillAllowed())) {
          closeStream();
          return;
        }
        if (closed) return;
        res.write(`event: update\ndata: {"conversationId":"${id}"}\n\n`);
      })();
    });

    // Keep-alive heartbeat every 25 s to prevent proxy/mobile connection timeouts.
    // Doubles as the periodic re-authorization tick for idle threads.
    heartbeat = setInterval(() => {
      void (async () => {
        if (closed) return;
        if (!(await stillAllowed())) {
          closeStream();
          return;
        }
        if (closed) return;
        res.write(": heartbeat\n\n");
      })();
    }, 25000);

    req.on("close", closeStream);
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
      // Marking read writes state onto a thread you must still be able to open.
      if (convo.type === "direct") {
        const denial = await directThreadDenial(id, userId);
        if (denial) {
          res.status(denial.status).json(denial.body);
          return;
        }
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
