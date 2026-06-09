import nodemailer from 'nodemailer';
import { logger } from './lib/logger';
import { sendEmail } from './services/email';
import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { getBaseUrl } from './lib/urls';

export interface ProWelcomeEmailData {
  toEmail: string;
  planName: string;
  priceAmount: number;
  priceCurrency: string;
  renewalDate: Date;
  manageUrl: string;
}

interface RenewalReceiptEmailData {
  toEmail: string;
  planName: string;
  amountPaid: number;
  currency: string;
  paidDate: Date;
  nextRenewalDate: Date | null;
  manageUrl: string;
  updatePaymentUrl: string;
  invoiceUrl: string | null;
}

interface PaymentFailedEmailData {
  toEmail: string;
  planName: string;
  amountDue: number;
  currency: string;
  failedDate: Date;
  nextRetryDate: Date | null;
  updatePaymentUrl: string;
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

function buildRenewalReceiptHtml(data: RenewalReceiptEmailData): string {
  const paid = formatCurrency(data.amountPaid, data.currency);
  const paidOn = formatDate(data.paidDate);
  const nextRenewal = data.nextRenewalDate ? formatDate(data.nextRenewalDate) : 'N/A';
  const invoiceLink = data.invoiceUrl
    ? `<a href="${data.invoiceUrl}" style="color:#7c3aed;">View Invoice</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Squadz Pro — Renewal Receipt</title>
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
                Your ${data.planName} subscription renewed ✓
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#9898b0;line-height:1.5;">
                Thanks for staying with Squadz Pro. Here's your renewal receipt.
              </p>

              <!-- Details table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Plan</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${data.planName}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Amount charged</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${paid}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Payment date</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${paidOn}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Next renewal</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${nextRenewal}</td>
                </tr>
              </table>

              ${invoiceLink ? `<p style="margin:20px 0 0;font-size:13px;color:#9898b0;text-align:center;">${invoiceLink}</p>` : ''}

              <!-- CTAs -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                <tr>
                  <td align="center" style="padding-bottom:12px;">
                    <a href="${data.manageUrl}"
                       style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                      Manage Subscription
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <a href="${data.updatePaymentUrl}"
                       style="display:inline-block;padding:12px 28px;background:transparent;border:1px solid rgba(255,255,255,0.2);color:#9898b0;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600;">
                      Update Payment Method
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:13px;color:#9898b0;text-align:center;line-height:1.5;">
                If you have any questions, reply to this email — we're here to help.
              </p>
            </td>
          </tr>

          <!-- Legal -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#55556a;">
                You're receiving this because you have an active ${data.planName} subscription on Squadz.
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

function buildRenewalReceiptText(data: RenewalReceiptEmailData): string {
  const paid = formatCurrency(data.amountPaid, data.currency);
  const paidOn = formatDate(data.paidDate);
  const nextRenewal = data.nextRenewalDate ? formatDate(data.nextRenewalDate) : 'N/A';

  return [
    `Your ${data.planName} subscription renewed`,
    '',
    'Thanks for staying with Squadz Pro. Here is your renewal receipt.',
    '',
    `Plan:           ${data.planName}`,
    `Amount charged: ${paid}`,
    `Payment date:   ${paidOn}`,
    `Next renewal:   ${nextRenewal}`,
    ...(data.invoiceUrl ? ['', `View invoice: ${data.invoiceUrl}`] : []),
    '',
    `Manage your subscription: ${data.manageUrl}`,
    `Update payment method:    ${data.updatePaymentUrl}`,
    '',
    '---',
    'Squadz',
  ].join('\n');
}

function buildPaymentFailedHtml(data: PaymentFailedEmailData): string {
  const due = formatCurrency(data.amountDue, data.currency);
  const failedOn = formatDate(data.failedDate);
  const retryLine = data.nextRetryDate
    ? `Stripe will automatically retry on <strong>${formatDate(data.nextRetryDate)}</strong>.`
    : 'Please update your payment method to keep your subscription active.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Action required — payment failed</title>
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

              <!-- Warning badge -->
              <p style="margin:0 0 16px;display:inline-block;padding:6px 14px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:99px;font-size:12px;font-weight:700;color:#f87171;letter-spacing:0.5px;text-transform:uppercase;">
                Action required
              </p>

              <!-- Title -->
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;">
                Payment failed for ${data.planName}
              </p>
              <p style="margin:0 0 32px;font-size:15px;color:#9898b0;line-height:1.5;">
                We couldn't process your payment. ${retryLine}
              </p>

              <!-- Details table -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Plan</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${data.planName}</td>
                </tr>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.08);">
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Amount due</td>
                  <td style="padding:14px 16px;font-size:14px;color:#f87171;font-weight:600;background:#13132a;text-align:right;">${due}</td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#9898b0;font-weight:500;background:#13132a;">Payment attempted</td>
                  <td style="padding:14px 16px;font-size:14px;color:#ffffff;font-weight:600;background:#13132a;text-align:right;">${failedOn}</td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
                <tr>
                  <td align="center">
                    <a href="${data.updatePaymentUrl}"
                       style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                      Update Payment Method
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:13px;color:#9898b0;text-align:center;line-height:1.5;">
                If you have any questions, reply to this email — we're here to help.
              </p>
            </td>
          </tr>

          <!-- Legal -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#55556a;">
                You're receiving this because you have a ${data.planName} subscription on Squadz.
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

function buildPaymentFailedText(data: PaymentFailedEmailData): string {
  const due = formatCurrency(data.amountDue, data.currency);
  const failedOn = formatDate(data.failedDate);
  const retryLine = data.nextRetryDate
    ? `Stripe will retry on ${formatDate(data.nextRetryDate)}.`
    : 'Please update your payment method to keep your subscription active.';

  return [
    `Action required: Payment failed for ${data.planName}`,
    '',
    `We couldn't process your payment of ${due}.`,
    retryLine,
    '',
    `Plan:               ${data.planName}`,
    `Amount due:         ${due}`,
    `Payment attempted:  ${failedOn}`,
    '',
    `Update your payment method: ${data.updatePaymentUrl}`,
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

export function getSmtpStatus(): { configured: boolean; host: string | undefined; port: number; user: string | undefined; from: string | undefined; missing: string[] } {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  const missing: string[] = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');
  if (!from) missing.push('SMTP_FROM');

  return {
    configured: missing.length === 0,
    host,
    port,
    user,
    from,
    missing,
  };
}

export class EmailService {
  async sendProWelcome(subscriptionId: string, customerId: string): Promise<void> {
    try {
      const data = await this.buildEmailData(subscriptionId, customerId);
      if (!data) {
        logger.warn({ subscriptionId, customerId }, 'sendProWelcome: could not build email data — skipping');
        return;
      }

      await sendEmail({
        from: process.env.SENDGRID_FROM ?? process.env.SMTP_FROM ?? 'Squadz <noreply@squadz.app>',
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

  async sendRenewalReceipt(invoiceId: string, customerId: string): Promise<void> {
    try {
      const data = await this.buildRenewalReceiptData(invoiceId, customerId);
      if (!data) {
        logger.warn({ invoiceId, customerId }, 'sendRenewalReceipt: could not build email data — skipping');
        return;
      }

      await sendEmail({
        from: process.env.SENDGRID_FROM ?? process.env.SMTP_FROM ?? 'Squadz <noreply@squadz.app>',
        to: data.toEmail,
        subject: `Your ${data.planName} subscription renewed — receipt enclosed`,
        text: buildRenewalReceiptText(data),
        html: buildRenewalReceiptHtml(data),
      });
      logger.info({ to: data.toEmail, planName: data.planName }, 'Renewal receipt email sent');
    } catch (err) {
      logger.error({ err, invoiceId, customerId }, 'Failed to send renewal receipt email');
    }
  }

  async sendPaymentFailed(invoiceId: string, customerId: string): Promise<void> {
    try {
      const data = await this.buildPaymentFailedData(invoiceId, customerId);
      if (!data) {
        logger.warn({ invoiceId, customerId }, 'sendPaymentFailed: could not build email data — skipping');
        return;
      }

      await sendEmail({
        from: process.env.SENDGRID_FROM ?? process.env.SMTP_FROM ?? 'Squadz <noreply@squadz.app>',
        to: data.toEmail,
        subject: `Action required: payment failed for your ${data.planName} subscription`,
        text: buildPaymentFailedText(data),
        html: buildPaymentFailedHtml(data),
      });
      logger.info({ to: data.toEmail, planName: data.planName }, 'Payment failed email sent');
    } catch (err) {
      logger.error({ err, invoiceId, customerId }, 'Failed to send payment failed email');
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

    const baseUrl = getBaseUrl();

    return {
      toEmail: customerEmail,
      planName,
      priceAmount,
      priceCurrency,
      renewalDate,
      manageUrl: `${baseUrl}/home`,
    };
  }

  private async buildRenewalReceiptData(
    invoiceId: string,
    customerId: string,
  ): Promise<RenewalReceiptEmailData | null> {
    const invoiceResult = await db.execute(sql`
      SELECT
        i.id,
        i.amount_paid,
        i.currency,
        i.status_transitions,
        i.period_end,
        i.hosted_invoice_url,
        i.subscription
      FROM stripe.invoices i
      WHERE i.id = ${invoiceId}
      LIMIT 1
    `);
    const invoice = invoiceResult.rows[0];
    if (!invoice) return null;

    const amountPaid = (invoice.amount_paid as number | null) ?? 0;
    const currency = (invoice.currency as string | null) ?? 'usd';

    const statusTransitions = invoice.status_transitions as Record<string, number | null> | null;
    const paidAtTs = statusTransitions?.paid_at ?? null;
    const paidDate = paidAtTs ? new Date(Number(paidAtTs) * 1000) : new Date();

    const periodEndTs = invoice.period_end as number | null;
    const nextRenewalDate = periodEndTs ? new Date(Number(periodEndTs) * 1000) : null;

    const invoiceUrl = (invoice.hosted_invoice_url as string | null) ?? null;
    const subscriptionId = invoice.subscription as string | null;

    let planName = 'Squadz Pro';
    if (subscriptionId) {
      const priceResult = await db.execute(sql`
        SELECT p.name as product_name
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
      planName = (priceResult.rows[0]?.product_name as string | null) ?? 'Squadz Pro';
    }

    const customerResult = await db.execute(sql`
      SELECT email FROM stripe.customers WHERE id = ${customerId} LIMIT 1
    `);
    const customerEmail = customerResult.rows[0]?.email as string | null;

    if (!customerEmail) {
      logger.warn({ customerId }, 'No email found for Stripe customer');
      return null;
    }

    const baseUrl = getBaseUrl();

    return {
      toEmail: customerEmail,
      planName,
      amountPaid,
      currency,
      paidDate,
      nextRenewalDate,
      manageUrl: `${baseUrl}/home`,
      updatePaymentUrl: `${baseUrl}/home`,
      invoiceUrl,
    };
  }

  private async buildPaymentFailedData(
    invoiceId: string,
    customerId: string,
  ): Promise<PaymentFailedEmailData | null> {
    const invoiceResult = await db.execute(sql`
      SELECT
        i.id,
        i.amount_due,
        i.currency,
        i.created,
        i.next_payment_attempt,
        i.subscription
      FROM stripe.invoices i
      WHERE i.id = ${invoiceId}
      LIMIT 1
    `);
    const invoice = invoiceResult.rows[0];
    if (!invoice) return null;

    const amountDue = (invoice.amount_due as number | null) ?? 0;
    const currency = (invoice.currency as string | null) ?? 'usd';

    const createdTs = invoice.created as number | null;
    const failedDate = createdTs ? new Date(Number(createdTs) * 1000) : new Date();

    const nextPaymentAttemptTs = invoice.next_payment_attempt as number | null;
    const nextRetryDate = nextPaymentAttemptTs
      ? new Date(Number(nextPaymentAttemptTs) * 1000)
      : null;

    const subscriptionId = invoice.subscription as string | null;

    let planName = 'Squadz Pro';
    if (subscriptionId) {
      const priceResult = await db.execute(sql`
        SELECT p.name as product_name
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
      planName = (priceResult.rows[0]?.product_name as string | null) ?? 'Squadz Pro';
    }

    const customerResult = await db.execute(sql`
      SELECT email FROM stripe.customers WHERE id = ${customerId} LIMIT 1
    `);
    const customerEmail = customerResult.rows[0]?.email as string | null;

    if (!customerEmail) {
      logger.warn({ customerId }, 'No email found for Stripe customer');
      return null;
    }

    const baseUrl = getBaseUrl();

    return {
      toEmail: customerEmail,
      planName,
      amountDue,
      currency,
      failedDate,
      nextRetryDate,
      updatePaymentUrl: `${baseUrl}/home`,
    };
  }
}

export const emailService = new EmailService();

// ── Account auth emails (email verification + password reset) ───────────────

function buildAuthEmailHtml(opts: {
  title: string;
  intro: string;
  buttonLabel: string;
  url: string;
  footnote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#e8e8f0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="font-size:28px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Squadz</div>
            </td>
          </tr>
          <tr>
            <td style="background:#1a1a2e;border-radius:16px;padding:40px;border:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;">${opts.title}</p>
              <p style="margin:0 0 32px;font-size:15px;color:#9898b0;line-height:1.5;">${opts.intro}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${opts.url}"
                       style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#FF5C3A,#A855F7);color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:0.2px;">
                      ${opts.buttonLabel}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:13px;color:#9898b0;text-align:center;line-height:1.5;">
                ${opts.footnote}
              </p>
              <p style="margin:18px 0 0;font-size:12px;color:#55556a;text-align:center;word-break:break-all;">
                Or paste this link into your browser:<br/>${opts.url}
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

export async function sendVerificationEmail(opts: {
  toEmail: string;
  verifyUrl: string;
}): Promise<void> {
  const subject = "Confirm your Squadz email";
  const html = buildAuthEmailHtml({
    title: "Confirm your email 🎉",
    intro:
      "Welcome to Squadz! Tap the button below to confirm your email address and finish setting up your account.",
    buttonLabel: "Confirm Email",
    url: opts.verifyUrl,
    footnote: "This link expires in 24 hours. If you didn't create a Squadz account, you can ignore this email.",
  });
  const text = [
    "Welcome to Squadz!",
    "",
    "Confirm your email address:",
    opts.verifyUrl,
    "",
    "This link expires in 24 hours.",
  ].join("\n");

  const transport = createTransport();
  const from = process.env.SMTP_FROM ?? "Squadz <noreply@squadz.app>";
  if (!transport) {
    // Only surface the tokenized URL in non-production so a developer can
    // complete the flow without SMTP. Never log raw tokens in production.
    logger.info(
      {
        to: opts.toEmail,
        subject,
        ...(process.env.NODE_ENV !== "production" ? { verifyUrl: opts.verifyUrl } : {}),
      },
      "Verification email (SMTP not configured — logged only)",
    );
    return;
  }
  await transport.sendMail({ from, to: opts.toEmail, subject, text, html });
  logger.info({ to: opts.toEmail }, "Verification email sent");
}

export async function sendPasswordResetEmail(opts: {
  toEmail: string;
  resetUrl: string;
}): Promise<void> {
  const subject = "Reset your Squadz password";
  const html = buildAuthEmailHtml({
    title: "Reset your password",
    intro:
      "We received a request to reset your Squadz password. Tap the button below to choose a new one.",
    buttonLabel: "Reset Password",
    url: opts.resetUrl,
    footnote: "This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password won't change.",
  });
  const text = [
    "Reset your Squadz password:",
    opts.resetUrl,
    "",
    "This link expires in 1 hour. If you didn't request this, ignore this email.",
  ].join("\n");

  const transport = createTransport();
  const from = process.env.SMTP_FROM ?? "Squadz <noreply@squadz.app>";
  if (!transport) {
    // Only surface the tokenized URL in non-production so a developer can
    // complete the flow without SMTP. Never log raw tokens in production.
    logger.info(
      {
        to: opts.toEmail,
        subject,
        ...(process.env.NODE_ENV !== "production" ? { resetUrl: opts.resetUrl } : {}),
      },
      "Password reset email (SMTP not configured — logged only)",
    );
    return;
  }
  await transport.sendMail({ from, to: opts.toEmail, subject, text, html });
  logger.info({ to: opts.toEmail }, "Password reset email sent");
}
