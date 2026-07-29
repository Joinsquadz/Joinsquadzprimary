import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Creates the webhook_email_sends dedup table if it does not yet exist.
 * Call once at server startup, before any webhook emails can be triggered.
 * Uses raw SQL so no drizzle-kit push is required.
 */
export async function ensureEmailDedupTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS webhook_email_sends (
        id TEXT PRIMARY KEY,
        sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);
    logger.info("webhook_email_sends dedup table ready");
  } catch (err) {
    logger.error({ err }, "[emailDedup] Failed to ensure webhook_email_sends table");
  }
}

/**
 * Marks an email as sent by inserting its dedup key.
 * Returns true  — first delivery, caller should send the email.
 * Returns false — already sent, caller should suppress the duplicate.
 *
 * On DB failure the function errs on the side of allowing the send (returns
 * true) so a temporary outage does not silently drop transactional emails.
 */
export async function markEmailSent(key: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`INSERT INTO webhook_email_sends (id) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING id`,
    );
    return result.rows.length > 0;
  } catch (err) {
    logger.warn({ err, key }, "[emailDedup] Dedup check failed — allowing send");
    return true;
  }
}
