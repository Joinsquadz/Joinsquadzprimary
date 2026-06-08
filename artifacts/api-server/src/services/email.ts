/**
 * Email transport adapter.
 *
 * Priority order:
 *  1. SendGrid  — set SENDGRID_API_KEY + SENDGRID_FROM
 *  2. SMTP      — set SMTP_HOST, SMTP_USER, SMTP_PASS (+ optional SMTP_FROM, SMTP_PORT)
 *  3. Log-only  — when neither is configured (dev / CI)
 */
import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";
import { logger } from "../lib/logger";

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_KEY) sgMail.setApiKey(SENDGRID_KEY);

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

function createSmtpTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT ?? "587", 10);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (SENDGRID_KEY) {
    await sgMail.send(msg);
    logger.info({ to: msg.to, subject: msg.subject }, "Email sent via SendGrid");
    return;
  }

  const transport = createSmtpTransport();
  if (transport) {
    await transport.sendMail(msg);
    logger.info({ to: msg.to, subject: msg.subject }, "Email sent via SMTP");
    return;
  }

  logger.info(
    { to: msg.to, subject: msg.subject },
    "Email (no transport configured — logged only)",
  );
  logger.info({ emailText: msg.text }, "Email body");
}

export function getEmailProviderStatus(): {
  provider: "sendgrid" | "smtp" | "none";
  configured: boolean;
  missing: string[];
} {
  if (SENDGRID_KEY) return { provider: "sendgrid", configured: true, missing: [] };

  const missing: string[] = [];
  if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS) missing.push("SMTP_PASS");
  if (missing.length === 0) return { provider: "smtp", configured: true, missing: [] };

  return { provider: "none", configured: false, missing: ["SENDGRID_API_KEY", ...missing] };
}
