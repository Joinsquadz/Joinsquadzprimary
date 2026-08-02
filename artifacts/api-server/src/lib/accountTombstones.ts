import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Account-deletion tombstones.
 *
 * When a user deletes their account we purge all app data and (best-effort)
 * delete the Supabase auth subject(s). If that external deletion fails — or a
 * linked identity we couldn't enumerate survives — the surviving credentials
 * would silently re-provision a fresh empty account on the next login via the
 * users-table upsert in the auth sync path. Tombstones close that hole: every
 * auth subject id we know about for the deleted account is recorded here
 * inside the same transaction that purges the data, and the login/signup sync
 * path refuses to re-create a users row for a tombstoned subject (deleting
 * the straggler auth subject when it can).
 *
 * Tombstones are keyed by AUTH SUBJECT id (not email), so a genuine new
 * signup with the same email — which gets a brand-new subject id — is
 * unaffected.
 *
 * Raw SQL, mirroring webhook_email_sends: no drizzle-kit push required.
 */
export async function ensureTombstoneTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS deleted_account_tombstones (
        subject_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);
    logger.info("deleted_account_tombstones table ready");
  } catch (err) {
    logger.error({ err }, "[tombstones] Failed to ensure deleted_account_tombstones table");
  }
}

/** Minimal executor shape so tombstones can be written inside a transaction. */
type SqlExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Record tombstones for every known auth subject id of a deleted account.
 * Call with the purge transaction so the tombstones commit atomically with
 * the data deletion.
 */
export async function insertTombstones(
  executor: SqlExecutor,
  subjectIds: string[],
  userId: string,
): Promise<void> {
  for (const subjectId of subjectIds) {
    await executor.execute(sql`
      INSERT INTO deleted_account_tombstones (subject_id, user_id)
      VALUES (${subjectId}, ${userId})
      ON CONFLICT (subject_id) DO NOTHING
    `);
  }
}

/**
 * True when ANY of the given auth subject ids belongs to a deleted account.
 * Fails CLOSED on DB errors only in the sense of logging and returning false —
 * login availability is preserved; the primary defence is the auth-subject
 * deletion, tombstones are the backstop.
 */
export async function isAnyTombstoned(subjectIds: string[]): Promise<boolean> {
  const ids = subjectIds.filter(Boolean);
  if (ids.length === 0) return false;
  try {
    const result = await db.execute(sql`
      SELECT subject_id FROM deleted_account_tombstones
      WHERE subject_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      LIMIT 1
    `);
    const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    logger.error({ err, subjectIds: ids }, "[tombstones] lookup failed");
    return false;
  }
}

/** Thrown by the auth sync path when a tombstoned subject tries to sign in. */
export class AccountDeletedError extends Error {
  constructor() {
    super("This account has been deleted.");
    this.name = "AccountDeletedError";
  }
}
