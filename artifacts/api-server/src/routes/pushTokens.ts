import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { Expo } from "expo-server-sdk";
import { requireAuth } from "../middleware/currentUser";
import { storage } from "../storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const RegisterBody = z.object({
  token: z.string().min(1),
});

/**
 * GET /api/push-token
 * Returns the push token the server currently has on record for the caller.
 * The mobile app uses this at launch to detect when its local token has drifted
 * from the server (e.g. after a DeviceNotRegistered clear) so it can prompt the
 * user to re-enable notifications.
 */
router.get("/push-token", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const token = await storage.getPushToken(userId);
    res.json({ token });
  } catch (err) {
    logger.error({ err }, "Error fetching push token");
    res.status(500).json({ error: "Failed to fetch push token" });
  }
});

/**
 * POST /api/push-token
 * Register (or refresh) the caller's Expo push token. Called by the mobile app
 * after the user grants notification permission. Idempotent — re-registering
 * the same token is a no-op.
 */
router.post("/push-token", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req.user as { id: string }).id;
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    const { token } = parsed.data;
    if (!Expo.isExpoPushToken(token)) {
      res.status(400).json({ error: "Invalid Expo push token" });
      return;
    }
    await storage.savePushToken(userId, token);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error registering push token");
    res.status(500).json({ error: "Failed to register push token" });
  }
});

export default router;
