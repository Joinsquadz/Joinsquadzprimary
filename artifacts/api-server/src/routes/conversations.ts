import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../middleware/currentUser";
import { logger } from "../lib/logger";

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
    const conversations = await storage.listConversationsForUser(userId);
    res.json(conversations);
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
      const [messages, participants] = await Promise.all([
        storage.getConversationMessages(id),
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
      const message = await storage.addConversationMessage(
        id,
        userId,
        parsed.data.text.trim(),
        parsed.data.attachments,
      );
      res.status(201).json(message);
    } catch (err) {
      logger.error({ err }, "Error sending message");
      res.status(500).json({ error: "Failed to send message" });
    }
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
