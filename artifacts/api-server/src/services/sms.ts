/**
 * SMS service — Twilio.
 * Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER to enable.
 * Calls gracefully no-op (return false) when env vars are absent.
 */
import twilio from "twilio";
import { logger } from "../lib/logger";

function init() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

const client = init();
const FROM = process.env.TWILIO_FROM_NUMBER;

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!client || !FROM) {
    logger.warn({ to }, "SMS not sent — TWILIO_* env vars not configured");
    return false;
  }
  try {
    await client.messages.create({ from: FROM, to, body });
    logger.info({ to }, "SMS sent via Twilio");
    return true;
  } catch (err) {
    logger.error({ err, to }, "Failed to send SMS via Twilio");
    return false;
  }
}

export function getSmsStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!process.env.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (!process.env.TWILIO_FROM_NUMBER) missing.push("TWILIO_FROM_NUMBER");
  return { configured: missing.length === 0, missing };
}
