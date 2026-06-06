import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const AddVaultPhotoBody = z.object({
  url: z.string().min(1),
  eventId: z.string().optional(),
});

router.get("/vault/photos", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === "active" || sub?.status === "trialing";
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    if (!isPro) {
      res.status(403).json({ error: "Photo Vault requires a Pro subscription", requiresPro: true });
      return;
    }

    const photos = await storage.getPhotosByUploaderId(userId);
    res.json({ photos });
  } catch (err) {
    logger.error({ err }, "Error fetching vault photos");
    res.status(500).json({ error: "Failed to fetch photos" });
  }
});

router.post("/vault/photos", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;

    let user = await storage.getUser(userId);
    if (!user) {
      user = await storage.upsertUser(userId, (req.user as { id: string; email?: string }).email ?? "");
    }

    const isPro = await (async () => {
      if (user!.stripeSubscriptionId) {
        const sub = await storage.getSubscription(user!.stripeSubscriptionId);
        return sub?.status === "active" || sub?.status === "trialing";
      }
      if (user!.stripeCustomerId) {
        const sub = await storage.getActiveSubscriptionByCustomerId(user!.stripeCustomerId);
        return !!sub;
      }
      return false;
    })();

    if (!isPro) {
      res.status(403).json({ error: "Photo Vault requires a Pro subscription", requiresPro: true });
      return;
    }

    const parsed = AddVaultPhotoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const photo = await storage.addPhoto(userId, parsed.data.url, parsed.data.eventId);
    res.status(201).json({ photo });
  } catch (err) {
    logger.error({ err }, "Error saving vault photo");
    res.status(500).json({ error: "Failed to save photo" });
  }
});

export default router;
