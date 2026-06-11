import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { sendEmail } from "../services/email";

const router: IRouter = Router();

const JoinWaitlistBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().max(40).optional(),
});

function buildWaitlistThankYouText(email: string): string {
  return [
    "Thanks for joining the Squadz waitlist!",
    "",
    "You're on the list. We'll email you the moment Squadz drops on the App Store and Google Play.",
    "",
    "In the meantime, follow us for updates and sneak peeks:",
    "  • Instagram: https://instagram.com/squadz.app",
    "  • TikTok: https://tiktok.com/@squadz.app",
    "",
    "Thanks for being early — we can't wait to get your squad hanging.",
    "",
    "— The Squadz team",
    "https://joinsquadz.com",
  ].join("\n");
}

function buildWaitlistThankYouHtml(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thanks for joining the Squadz waitlist!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0F; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    .logo { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #FF5C3A 0%, #FFB84D 100%); margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 16px; }
    p { font-size: 16px; line-height: 1.6; color: #E2E2E8; margin: 0 0 12px; }
    .social { margin-top: 24px; padding-top: 24px; border-top: 1px solid #2A2A3A; }
    .social a { display: inline-block; margin-right: 16px; color: #FF5C3A; text-decoration: none; font-weight: 600; }
    .footer { margin-top: 32px; font-size: 13px; color: #8B8B9E; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo"></div>
    <h1>Thanks for joining the Squadz waitlist!</h1>
    <p>You're on the list. We'll email you the moment Squadz drops on the App Store and Google Play.</p>
    <div class="social">
      <p style="font-weight: 600; margin-bottom: 8px;">Follow us for updates:</p>
      <a href="https://instagram.com/squadz.app">Instagram</a>
      <a href="https://tiktok.com/@squadz.app">TikTok</a>
    </div>
    <div class="footer">
      <p>Thanks for being early — we can't wait to get your squad hanging.</p>
      <p>— The Squadz team<br><a href="https://joinsquadz.com" style="color: #8B8B9E;">joinsquadz.com</a></p>
    </div>
  </div>
</body>
</html>`;
}

const FROM_ADDRESS = process.env.SENDGRID_FROM ?? process.env.SMTP_FROM ?? "Squadz <noreply@joinsquadz.com>";
const NOTIFY_ADDRESS = "javier@joinsquadz.com";

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

    // Await both emails before responding so they complete before the process
    // can be frozen/scaled-down (autoscale deployments may suspend the process
    // immediately after the response is sent, abandoning fire-and-forget promises).
    const [thankYouResult, notifyResult] = await Promise.allSettled([
      sendEmail({
        from: FROM_ADDRESS,
        to: parsed.data.email,
        subject: "You're on the Squadz waitlist!",
        text: buildWaitlistThankYouText(parsed.data.email),
        html: buildWaitlistThankYouHtml(parsed.data.email),
      }),
      sendEmail({
        from: FROM_ADDRESS,
        to: NOTIFY_ADDRESS,
        subject: "New Squadz waitlist signup",
        text: `New waitlist signup: ${parsed.data.email}\nSource: ${parsed.data.source ?? "web-landing"}`,
        html: `<p>New waitlist signup: <strong>${parsed.data.email}</strong></p><p>Source: ${parsed.data.source ?? "web-landing"}</p>`,
      }),
    ]);

    if (thankYouResult.status === "rejected") {
      logger.error({ err: thankYouResult.reason, email: parsed.data.email }, "Failed to send waitlist thank-you email");
    }
    if (notifyResult.status === "rejected") {
      logger.error({ err: notifyResult.reason, email: parsed.data.email }, "Failed to send waitlist notification email");
    }

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
