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
  // Email-safe markup: table-based layout, inline styles, NO inline <svg>
  // (Gmail and most clients strip <svg>), and a solid color fallback behind
  // any gradient so the brand always renders.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're on the Squadz waitlist!</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e8e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <span style="display:inline-block;font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Squad<span style="color:#FF5C3A;">z</span></span>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a2e;border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;">You're on the list! 🎉</p>
              <p style="margin:0 0 12px;font-size:15px;color:#c8c8d8;line-height:1.6;">Thanks for joining the Squadz waitlist. We'll email you the moment Squadz drops on the App Store and Google Play.</p>
              <p style="margin:0 0 4px;font-size:15px;color:#c8c8d8;line-height:1.6;">Thanks for being early — we can't wait to get your squad hanging.</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0;font-size:13px;color:#9898b0;">— The Squadz team</p>
              <p style="margin:6px 0 0;font-size:13px;"><a href="https://joinsquadz.com" style="color:#FF5C3A;text-decoration:none;">joinsquadz.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
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
 * Cached for 60 s so repeated page loads don't hammer the DB.
 */
let _countCache: { value: number; expiresAt: number } | null = null;

router.get("/waitlist/count", async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = Date.now();
    if (!_countCache || now > _countCache.expiresAt) {
      const count = await storage.getWaitlistCount();
      _countCache = { value: count, expiresAt: now + 60_000 };
    }
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.status(200).json({ count: _countCache.value });
  } catch (err) {
    logger.error({ err }, "Error fetching waitlist count");
    res.status(500).json({ error: "Failed to fetch count" });
  }
});

export default router;
