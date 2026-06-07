import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const JoinWaitlistBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().max(40).optional(),
});

/**
 * POST /api/waitlist
 * Public endpoint for the marketing landing page. Captures an email so we can
 * notify the user when the mobile app launches. Idempotent on email.
 */
router.post("/waitlist", async (req: Request, res: Response): Promise<void> => {
  const parsed = JoinWaitlistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }
  try {
    await storage.addToWaitlist(parsed.data.email, parsed.data.source ?? "web-landing");
    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error adding to waitlist");
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

/**
 * GET /api/waitlist/count
 * Public count used for social proof on the landing page.
 */
router.get("/waitlist/count", async (_req: Request, res: Response): Promise<void> => {
  try {
    const count = await storage.getWaitlistCount();
    res.status(200).json({ count });
  } catch (err) {
    logger.error({ err }, "Error fetching waitlist count");
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

export default router;
