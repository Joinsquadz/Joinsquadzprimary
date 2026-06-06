import nodemailer from 'nodemailer';
import { logger } from './lib/logger';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

export interface ProWelcomeEmailData {
  toEmail: string;
  planName: string;
  priceAmount: number;
  priceCurrency: string;
  renewalDate: Date;
  manageUrl: string;
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

export function buildProWelcomeHtml(data: ProWelcomeEmailData): string {
  return buildHtml(data);
}

function buildHtml(data: ProWelcomeEmailData): string {
  const price = formatCurrency(data.priceAmount, data.priceCurrency);
  const renewal = formatDate(data.renewalDate);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Squadz Pro</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e8e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">
                Squadz
              </div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#1a1a2e;border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.08);">

              <!-- Title -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;">
                Welcome to ${data.planName}! 🎉
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#9898b0;line-height:1.5;">
                Your subscription is active. Here's a summary of what you've unlocked.
              </p>

              <!-- Details table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Plan</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${data.planName}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Amount</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${price} / month</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Next renewal</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${renewal}</td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                <tr>
                  <td align="center">
                    <a href="${data.manageUrl}"
                       style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                      Manage Subscription
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Footer note -->
              <p style="margin:28px 0 0;font-size:13px;color:#9898b0;text-align:center;line-height:1.5;">
                If you have any questions, reply to this email — we're here to help.
              </p>
            </td>
          </tr>

          <!-- Legal -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#55556a;">
                You're receiving this because you subscribed to ${data.planName} on Squadz.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildText(data: ProWelcomeEmailData): string {
  const price = formatCurrency(data.priceAmount, data.priceCurrency);
  const renewal = formatDate(data.renewalDate);

  return [
    `Welcome to ${data.planName}!`,
    '',
    'Your Squadz Pro subscription is now active.',
    '',
    `Plan:         ${data.planName}`,
    `Amount:       ${price} / month`,
    `Next renewal: ${renewal}`,
    '',
    `Manage your subscription: ${data.manageUrl}`,
    '',
    '---',
    'Squadz',
  ].join('\n');
}

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export class EmailService {
  async sendProWelcome(subscriptionId: string, customerId: string): Promise<void> {
    try {
      const data = await this.buildEmailData(subscriptionId, customerId);
      if (!data) {
        logger.warn({ subscriptionId, customerId }, 'sendProWelcome: could not build email data — skipping');
        return;
      }

      const transport = createTransport();
      const from = process.env.SMTP_FROM ?? 'Squadz <noreply@squadz.app>';

      if (!transport) {
        logger.info(
          { to: data.toEmail, subject: `Welcome to ${data.planName}` },
          'Pro welcome email (SMTP not configured — logged only)'
        );
        logger.info({ emailText: buildText(data) }, 'Pro welcome email body');
        return;
      }

      await transport.sendMail({
        from,
        to: data.toEmail,
        subject: `Welcome to ${data.planName}! Your subscription is active`,
        text: buildText(data),
        html: buildHtml(data),
      });

      logger.info({ to: data.toEmail, planName: data.planName }, 'Pro welcome email sent');
    } catch (err) {
      logger.error({ err, subscriptionId, customerId }, 'Failed to send Pro welcome email');
    }
  }

  private async buildEmailData(
    subscriptionId: string,
    customerId: string,
  ): Promise<ProWelcomeEmailData | null> {
    const subResult = await db.execute(sql`
      SELECT
        s.id,
        s.customer,
        s.current_period_end,
        s.items
      FROM stripe.subscriptions s
      WHERE s.id = ${subscriptionId}
      LIMIT 1
    `);
    const sub = subResult.rows[0];
    if (!sub) return null;

    const currentPeriodEnd = sub.current_period_end;
    const renewalDate = currentPeriodEnd
      ? new Date(Number(currentPeriodEnd) * 1000)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const priceResult = await db.execute(sql`
      SELECT
        pr.id,
        pr.unit_amount,
        pr.currency,
        p.name as product_name
      FROM stripe.subscriptions s
      JOIN stripe.prices pr
        ON pr.id = (
          SELECT item->>'price'
          FROM jsonb_array_elements(s.items->'data') AS item
          LIMIT 1
        )
      JOIN stripe.products p ON p.id = pr.product
      WHERE s.id = ${subscriptionId}
      LIMIT 1
    `);
    const priceRow = priceResult.rows[0];

    const planName = (priceRow?.product_name as string | null) ?? 'Squadz Pro';
    const priceAmount = (priceRow?.unit_amount as number | null) ?? 0;
    const priceCurrency = (priceRow?.currency as string | null) ?? 'usd';

    const customerResult = await db.execute(sql`
      SELECT email FROM stripe.customers WHERE id = ${customerId} LIMIT 1
    `);
    const customerEmail = customerResult.rows[0]?.email as string | null;

    if (!customerEmail) {
      logger.warn({ customerId }, 'No email found for Stripe customer');
      return null;
    }

    const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0] ?? 'localhost'}`;

    return {
      toEmail: customerEmail,
      planName,
      priceAmount,
      priceCurrency,
      renewalDate,
      manageUrl: `${baseUrl}/home`,
    };
  }
}

export const emailService = new EmailService();
