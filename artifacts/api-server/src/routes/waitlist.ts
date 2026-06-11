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

function buildWaitlistThankYouText(_email: string): string {
  return [
    "Thanks for joining the Squadz waitlist!",
    "",
    "You're on the list. We'll email you the moment Squadz drops on the App Store and Google Play.",
    "",
    "Thanks for being early — we can't wait to get your squad hanging.",
    "",
    "— The Squadz team",
    "https://joinsquadz.com",
  ].join("\n");
}

function buildWaitlistThankYouHtml(_email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thanks for joining the Squadz waitlist!</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0A0A0F; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 480px; margin: 0 auto; padding: 40px 24px; }
    h1 { font-size: 24px; font-weight: 800; margin: 0 0 16px; }
    p { font-size: 16px; line-height: 1.6; color: #E2E2E8; margin: 0 0 12px; }
    .footer { margin-top: 32px; font-size: 13px; color: #8B8B9E; }
  </style>
</head>
<body>
  <div class="container">
    <svg width="52" height="52" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" style="display:block;border-radius:12px;margin-bottom:24px">
      <defs>
        <linearGradient id="sq-zg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FF5C3A"/>
          <stop offset="100%" stop-color="#FFB547"/>
        </linearGradient>
        <linearGradient id="sq-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1E1E2E"/>
          <stop offset="100%" stop-color="#0A0A14"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="512" height="512" rx="114" fill="url(#sq-bg)"/>
      <path d="M 81,81 L 431,81 L 431,151 L 151,361 L 431,361 L 431,431 L 81,431 L 81,361 L 361,151 L 81,151 Z" fill="url(#sq-zg)"/>
    </svg>
    <h1>Thanks for joining the Squadz waitlist!</h1>
    <p>You're on the list. We'll email you the moment Squadz drops on the App Store and Google Play.</p>
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
