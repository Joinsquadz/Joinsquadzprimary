import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import { buildProWelcomeHtml, type ProWelcomeEmailData } from '../emailService';
import { requireAuth } from '../middleware/currentUser';
import { requireInternalToken } from '../middleware/adminToken';
import nodemailer from 'nodemailer';
import { logger } from '../lib/logger';

const router: IRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SAMPLE_DATA: ProWelcomeEmailData = {
  toEmail: 'preview@example.com',
  planName: 'SquadZ Pro',
  priceAmount: 999,
  priceCurrency: 'usd',
  renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  manageUrl: 'https://joinsquadz.com/home',
};

function buildSampleText(data: ProWelcomeEmailData): string {
  const price = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: data.priceCurrency.toUpperCase(),
  }).format(data.priceAmount / 100);

  const renewal = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(data.renewalDate);

  return [
    `Welcome to ${data.planName}!`,
    '',
    'Your SquadZ Pro subscription is now active.',
    '',
    `Plan:         ${data.planName}`,
    `Amount:       ${price} / month`,
    `Next renewal: ${renewal}`,
    '',
    `Manage your subscription: ${data.manageUrl}`,
    '',
    '---',
    'SquadZ',
  ].join('\n');
}

function requireEmailPreviewEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (process.env.ENABLE_EMAIL_PREVIEW_TEST !== 'true') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}

function getAdminEmails(): Set<string> {
  const raw = process.env.EMAIL_PREVIEW_ADMIN_EMAILS ?? '';
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

function requireAdminEmail(req: Request, res: Response, next: NextFunction): void {
  const admins = getAdminEmails();
  if (admins.size === 0) {
    res.status(503).json({
      error: 'EMAIL_PREVIEW_ADMIN_EMAILS is not configured — send-test is disabled.',
      hint: 'Set EMAIL_PREVIEW_ADMIN_EMAILS to a comma-separated list of operator email addresses.',
    });
    return;
  }

  const userEmail = (req.user as { email?: string } | undefined)?.email?.toLowerCase() ?? '';
  if (!admins.has(userEmail)) {
    logger.warn({ userEmail }, 'Unauthorized attempt to use email send-test endpoint');
    res.status(403).json({ error: 'Forbidden — operator access only.' });
    return;
  }

  next();
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = (req.user as { email?: string } | undefined)?.email ?? req.ip ?? 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: `Rate limit exceeded — max ${RATE_LIMIT_MAX} test sends per minute.`,
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  entry.count += 1;
  next();
}

router.get('/email/preview/welcome', requireInternalToken, requireEmailPreviewEnabled, (_req: Request, res: Response) => {
  const html = buildProWelcomeHtml(SAMPLE_DATA);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/email/preview/welcome/text', requireInternalToken, requireEmailPreviewEnabled, (_req: Request, res: Response) => {
  const text = buildSampleText(SAMPLE_DATA);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(text);
});

router.post(
  '/email/preview/send-test',
  requireEmailPreviewEnabled,
  requireAuth,
  requireAdminEmail,
  rateLimit,
  async (req: Request, res: Response): Promise<void> => {
    const to = req.body?.to as string | undefined;
    if (!to || !EMAIL_RE.test(to)) {
      res.status(400).json({ error: 'Provide a valid "to" email address in the request body.' });
      return;
    }

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM ?? 'SquadZ <noreply@joinsquadz.com>';

    if (!host || !user || !pass) {
      res.status(503).json({
        error: 'SMTP not configured.',
        missing: [
          ...(!host ? ['SMTP_HOST'] : []),
          ...(!user ? ['SMTP_USER'] : []),
          ...(!pass ? ['SMTP_PASS'] : []),
        ],
        hint: 'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM as environment secrets.',
      });
      return;
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const requesterEmail = (req.user as { email?: string } | undefined)?.email ?? 'unknown';
    const sample = { ...SAMPLE_DATA, toEmail: to };
    const html = buildProWelcomeHtml(sample);
    const text = buildSampleText(sample);

    try {
      const info = await transport.sendMail({
        from,
        to,
        subject: `[Deliverability test] Welcome to ${sample.planName}! Your subscription is active`,
        text,
        html,
      });

      logger.info(
        { to, messageId: info.messageId, triggeredBy: requesterEmail },
        'Test Pro welcome email sent',
      );

      res.json({
        ok: true,
        messageId: info.messageId,
        to,
        from,
        note: 'Check the inbox (and spam/junk folder) to confirm delivery and rendering.',
      });
    } catch (err) {
      logger.error({ err, to, triggeredBy: requesterEmail }, 'Failed to send test email');
      res.status(500).json({ error: 'Failed to send email. Check server logs for details.' });
    }
  },
);

export default router;
