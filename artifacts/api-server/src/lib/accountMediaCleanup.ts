/**
 * Account-deletion media cleanup.
 *
 * Deleting an account purges its DB rows, but the BYTES live in three places:
 *   1. the PRIVATE Supabase bucket (vault photos, moments, attachments, receipts)
 *   2. the PUBLIC Supabase avatar bucket (profile image)
 *   3. the Cloudflare R2 nightly backup mirror of both buckets
 *
 * Ownership rules (deliberately narrow — over-deletion is worse than a leftover):
 *   - Private objects are resolved ONLY from `object_uploads` rows whose
 *     owner_id is the deleted user, and only for the EXACT recorded object_path.
 *     No path-prefix guessing: `uploads/<uuid>.<ext>` is a flat namespace shared
 *     by every user, so a prefix sweep would delete other people's media.
 *   - The avatar is deleted only when `users.profile_image_url` parses as a URL
 *     on the configured Supabase host, inside the configured PUBLIC bucket.
 *     Anything else (Google/Apple provider avatars, gravatar, an external CDN)
 *     is left untouched.
 *   - R2 keys are derived from an owned Supabase target as
 *     `supabase/<bucket>/<object-key>` — exactly the key the backup writer used —
 *     so only that object's backup copy is removed.
 *
 * Durability: the DB purge is the source of truth and must never be blocked by a
 * storage outage. Anything that fails here is written to
 * `account_media_cleanup` and retried by a background worker, and reported to
 * Sentry so a silent leak is impossible.
 */
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { pool } from "@workspace/db";
import { supabaseAdmin } from "../services/supabase";
import { logger } from "./logger";
import { captureException, captureMessage } from "../services/monitoring";

const PRIVATE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "squadz-media";
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET ?? "squadz-avatars";

/** Supabase `remove()` and R2 `DeleteObjects` both take key batches. */
const SUPABASE_BATCH = 100;
const R2_BATCH = 100;

/** Queue rows are dropped (loudly) after this many failed attempts. */
export const MAX_CLEANUP_ATTEMPTS = 8;
const RETRY_BASE_MINUTES = 5;
const RETRY_PAGE_SIZE = 200;

export type MediaStore = "supabase" | "r2";

export type CleanupItem = {
  store: MediaStore;
  /** Supabase bucket name, or the R2 backup bucket for `store: "r2"`. */
  bucket: string;
  key: string;
};

export type CleanupSummary = {
  userId: string;
  /** Owned Supabase objects resolved from provenance + a validated avatar. */
  targets: number;
  supabaseDeleted: number;
  r2Deleted: number;
  failed: number;
  /** Legacy (non-Supabase) object paths that this cleaner cannot address. */
  skippedLegacy: number;
  /** External / non-app avatar URLs deliberately left alone. */
  skippedExternalAvatar: boolean;
};

// ── Ownership parsing ────────────────────────────────────────────────────────

/**
 * `/objects/supabase/<key>` → `<key>`; anything else (legacy Replit object
 * paths, absolute URLs, traversal attempts) → null.
 */
export function parsePrivateObjectKey(objectPath: string | null | undefined): string | null {
  const prefix = "/objects/supabase/";
  if (!objectPath || !objectPath.startsWith(prefix)) return null;
  const key = objectPath.slice(prefix.length);
  if (!key || key.startsWith("/") || key.includes("..")) return null;
  return key;
}

/**
 * Accepts ONLY a public URL served by the configured Supabase project from the
 * configured public avatar bucket. Returns the object key, or null for any
 * external URL — deleting from a URL we do not own is out of the question.
 */
export function parsePublicAvatarKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return null;

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (parsed.host !== base.host) return null;

  const marker = `/storage/v1/object/public/${PUBLIC_BUCKET}/`;
  if (!parsed.pathname.startsWith(marker)) return null;

  let key: string;
  try {
    key = decodeURIComponent(parsed.pathname.slice(marker.length));
  } catch {
    return null;
  }
  if (!key || key.startsWith("/") || key.includes("..")) return null;
  return key;
}

/**
 * Resolve every storage object the user owns. MUST run BEFORE the deletion
 * transaction: it reads `object_uploads`, which the purge removes.
 */
export async function collectAccountMediaTargets(
  userId: string,
  profileImageUrl: string | null | undefined,
): Promise<{ targets: CleanupItem[]; skippedLegacy: number; skippedExternalAvatar: boolean }> {
  const targets: CleanupItem[] = [];
  const seen = new Set<string>();
  let skippedLegacy = 0;

  const owned = await pool.query<{ object_path: string }>(
    `SELECT object_path FROM object_uploads WHERE owner_id = $1`,
    [userId],
  );
  for (const row of owned.rows) {
    const key = parsePrivateObjectKey(row.object_path);
    if (!key) {
      skippedLegacy += 1;
      continue;
    }
    const id = `${PRIVATE_BUCKET}/${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    targets.push({ store: "supabase", bucket: PRIVATE_BUCKET, key });
  }

  const avatarKey = parsePublicAvatarKey(profileImageUrl);
  if (avatarKey) {
    const id = `${PUBLIC_BUCKET}/${avatarKey}`;
    if (!seen.has(id)) {
      seen.add(id);
      targets.push({ store: "supabase", bucket: PUBLIC_BUCKET, key: avatarKey });
    }
  }

  return {
    targets,
    skippedLegacy,
    skippedExternalAvatar: Boolean(profileImageUrl) && avatarKey === null,
  };
}

// ── Deletion ─────────────────────────────────────────────────────────────────

function r2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_ENDPOINT &&
    process.env.R2_BACKUP_BUCKET,
  );
}

function r2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/** Mirrors the backup writer's key derivation exactly. */
export function backupKeyFor(target: CleanupItem): string {
  return `supabase/${target.bucket}/${target.key}`;
}

function r2ItemsFor(targets: CleanupItem[]): CleanupItem[] {
  if (!r2Configured()) return [];
  const bucket = process.env.R2_BACKUP_BUCKET!;
  return targets
    .filter((t) => t.store === "supabase")
    .map((t) => ({ store: "r2" as const, bucket, key: backupKeyFor(t) }));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ProcessResult = {
  deleted: CleanupItem[];
  failed: Array<{ item: CleanupItem; error: string }>;
};

async function deleteSupabaseItems(items: CleanupItem[]): Promise<ProcessResult> {
  const result: ProcessResult = { deleted: [], failed: [] };
  if (items.length === 0) return result;

  if (!supabaseAdmin) {
    for (const item of items) result.failed.push({ item, error: "Supabase is not configured" });
    return result;
  }

  const byBucket = new Map<string, CleanupItem[]>();
  for (const item of items) {
    const list = byBucket.get(item.bucket) ?? [];
    list.push(item);
    byBucket.set(item.bucket, list);
  }

  for (const [bucket, bucketItems] of byBucket) {
    for (const batch of chunk(bucketItems, SUPABASE_BATCH)) {
      try {
        const { error } = await supabaseAdmin.storage.from(bucket).remove(batch.map((i) => i.key));
        if (error) throw new Error(error.message);
        // Supabase remove() is idempotent: a missing object is not an error, so a
        // clean response means the bytes are gone either way.
        result.deleted.push(...batch);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const item of batch) result.failed.push({ item, error: message });
      }
    }
  }
  return result;
}

async function deleteR2Items(items: CleanupItem[]): Promise<ProcessResult> {
  const result: ProcessResult = { deleted: [], failed: [] };
  if (items.length === 0) return result;

  if (!r2Configured()) {
    // Nothing to mirror-delete: the backup was never written either.
    return result;
  }

  const client = r2Client();
  const byBucket = new Map<string, CleanupItem[]>();
  for (const item of items) {
    const list = byBucket.get(item.bucket) ?? [];
    list.push(item);
    byBucket.set(item.bucket, list);
  }

  for (const [bucket, bucketItems] of byBucket) {
    for (const batch of chunk(bucketItems, R2_BATCH)) {
      try {
        const response = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((i) => ({ Key: i.key })), Quiet: true },
          }),
        );
        const errors = (response as { Errors?: Array<{ Key?: string; Message?: string }> }).Errors ?? [];
        const failedKeys = new Map(errors.map((e) => [e.Key ?? "", e.Message ?? "delete failed"]));
        for (const item of batch) {
          const error = failedKeys.get(item.key);
          if (error) result.failed.push({ item, error });
          else result.deleted.push(item);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const item of batch) result.failed.push({ item, error: message });
      }
    }
  }
  return result;
}

async function processItems(items: CleanupItem[]): Promise<ProcessResult> {
  const supabase = await deleteSupabaseItems(items.filter((i) => i.store === "supabase"));
  const r2 = await deleteR2Items(items.filter((i) => i.store === "r2"));
  return {
    deleted: [...supabase.deleted, ...r2.deleted],
    failed: [...supabase.failed, ...r2.failed],
  };
}

// ── Retry queue ──────────────────────────────────────────────────────────────

async function enqueueFailures(
  userId: string,
  failures: Array<{ item: CleanupItem; error: string }>,
): Promise<void> {
  for (const { item, error } of failures) {
    try {
      await pool.query(
        `INSERT INTO account_media_cleanup (user_id, store, bucket, object_key, attempts, last_error, next_attempt_at)
         VALUES ($1, $2, $3, $4, 1, $5, now() + ($6 || ' minutes')::interval)
         ON CONFLICT (store, bucket, object_key) DO UPDATE
         SET attempts = account_media_cleanup.attempts + 1,
             last_error = EXCLUDED.last_error,
             next_attempt_at = EXCLUDED.next_attempt_at`,
        [userId, item.store, item.bucket, item.key, error.slice(0, 500), String(RETRY_BASE_MINUTES)],
      );
    } catch (err) {
      // The queue itself is unavailable — this is the one case where the leak
      // could go unnoticed, so it must reach Sentry with the concrete object.
      logger.error({ err, userId, store: item.store, bucket: item.bucket }, "[account-cleanup] could not enqueue retry");
      captureException(err, {
        scope: "account-media-cleanup-enqueue",
        userId,
        store: item.store,
        bucket: item.bucket,
        key: item.key,
      });
    }
  }
}

/**
 * Delete every media byte owned by a deleted account.
 *
 * Never throws: account deletion has already committed by the time this runs,
 * so a storage outage must degrade into a retryable queue entry plus a Sentry
 * report, not a 500 that tells the user their deletion failed.
 */
export async function deleteAccountMedia(
  userId: string,
  collected: { targets: CleanupItem[]; skippedLegacy: number; skippedExternalAvatar: boolean },
): Promise<CleanupSummary> {
  const { targets, skippedLegacy, skippedExternalAvatar } = collected;
  const summary: CleanupSummary = {
    userId,
    targets: targets.length,
    supabaseDeleted: 0,
    r2Deleted: 0,
    failed: 0,
    skippedLegacy,
    skippedExternalAvatar,
  };

  if (targets.length === 0) {
    if (skippedLegacy > 0 || skippedExternalAvatar) {
      logger.info(summary, "[account-cleanup] no owned Supabase media to delete");
    }
    return summary;
  }

  try {
    const items = [...targets, ...r2ItemsFor(targets)];
    const { deleted, failed } = await processItems(items);

    summary.supabaseDeleted = deleted.filter((i) => i.store === "supabase").length;
    summary.r2Deleted = deleted.filter((i) => i.store === "r2").length;
    summary.failed = failed.length;

    if (failed.length > 0) {
      await enqueueFailures(userId, failed);
      logger.error(
        { ...summary, sample: failed.slice(0, 3).map((f) => ({ store: f.item.store, error: f.error })) },
        "[account-cleanup] some media could not be deleted; queued for retry",
      );
      captureMessage(
        `Account media cleanup left ${failed.length} object(s) undeleted for a deleted account; queued for retry`,
        "error",
      );
    } else {
      logger.info(summary, "[account-cleanup] media deleted");
    }
  } catch (err) {
    // Defensive: processItems already contains its own failures per batch.
    summary.failed = targets.length;
    logger.error({ err, userId }, "[account-cleanup] media cleanup failed outright");
    captureException(err, { scope: "account-media-cleanup", userId, targets: targets.length });
    await enqueueFailures(
      userId,
      [...targets, ...r2ItemsFor(targets)].map((item) => ({
        item,
        error: err instanceof Error ? err.message : String(err),
      })),
    );
  }

  return summary;
}

/**
 * Delete the bytes of ONE private object the app knows the caller owns, plus
 * its R2 backup mirror.
 *
 * Used by lifecycle deletes that happen while the account is very much alive —
 * un-saving a vault copy, for example. Same durability contract as account
 * cleanup: never throws, and anything that fails is queued for the retry
 * worker rather than leaking silently. The CALLER is responsible for proving
 * ownership and for making sure no surviving row still references the object.
 */
export async function deleteOwnedMediaObject(
  userId: string,
  objectPath: string,
): Promise<{ deleted: boolean; queued: boolean }> {
  const key = parsePrivateObjectKey(objectPath);
  // Public URLs and legacy paths have no private object to remove.
  if (!key) return { deleted: false, queued: false };

  const target: CleanupItem = { store: "supabase", bucket: PRIVATE_BUCKET, key };
  try {
    const { deleted, failed } = await processItems([target, ...r2ItemsFor([target])]);
    if (failed.length > 0) {
      await enqueueFailures(userId, failed);
      logger.warn(
        { userId, key, failed: failed.length },
        "[media-delete] could not delete media bytes; queued for retry",
      );
      return { deleted: deleted.length > 0, queued: true };
    }
    return { deleted: deleted.length > 0, queued: false };
  } catch (err) {
    logger.error({ err, userId, key }, "[media-delete] media delete failed outright");
    captureException(err, { scope: "owned-media-delete", userId, key });
    await enqueueFailures(userId, [
      { item: target, error: err instanceof Error ? err.message : String(err) },
    ]);
    return { deleted: false, queued: true };
  }
}

type QueueRow = {
  id: string;
  user_id: string;
  store: MediaStore;
  bucket: string;
  object_key: string;
  attempts: number;
};

/**
 * Retry queued deletions. Exponential-ish backoff on the row itself so a broken
 * object cannot spin, and a hard attempt cap that escalates to Sentry rather
 * than retrying forever in silence.
 */
export async function retryPendingAccountMediaCleanup(): Promise<{
  attempted: number;
  deleted: number;
  failed: number;
  abandoned: number;
}> {
  const result = { attempted: 0, deleted: 0, failed: 0, abandoned: 0 };

  let rows: QueueRow[];
  try {
    const pending = await pool.query<QueueRow>(
      `SELECT id, user_id, store, bucket, object_key, attempts
         FROM account_media_cleanup
        WHERE next_attempt_at <= now()
        ORDER BY next_attempt_at ASC
        LIMIT $1`,
      [RETRY_PAGE_SIZE],
    );
    rows = pending.rows;
  } catch (err) {
    logger.warn({ err }, "[account-cleanup] could not read retry queue");
    return result;
  }

  if (rows.length === 0) return result;
  result.attempted = rows.length;

  const byId = new Map<string, QueueRow>();
  const items: CleanupItem[] = rows.map((row) => {
    const item: CleanupItem = { store: row.store, bucket: row.bucket, key: row.object_key };
    byId.set(`${item.store}:${item.bucket}:${item.key}`, row);
    return item;
  });

  const { deleted, failed } = await processItems(items);
  result.deleted = deleted.length;
  result.failed = failed.length;

  for (const item of deleted) {
    const row = byId.get(`${item.store}:${item.bucket}:${item.key}`);
    if (!row) continue;
    await pool
      .query(`DELETE FROM account_media_cleanup WHERE id = $1`, [row.id])
      .catch((err) => logger.warn({ err, id: row.id }, "[account-cleanup] could not clear retry row"));
  }

  for (const { item, error } of failed) {
    const row = byId.get(`${item.store}:${item.bucket}:${item.key}`);
    if (!row) continue;
    const attempts = row.attempts + 1;
    if (attempts >= MAX_CLEANUP_ATTEMPTS) {
      result.abandoned += 1;
      logger.error(
        { userId: row.user_id, store: row.store, bucket: row.bucket, attempts, error },
        "[account-cleanup] giving up on a media object after repeated failures",
      );
      captureMessage(
        `Account media cleanup permanently failed for ${row.store}:${row.bucket} after ${attempts} attempts — manual deletion required`,
        "error",
      );
      await pool
        .query(`DELETE FROM account_media_cleanup WHERE id = $1`, [row.id])
        .catch(() => undefined);
      continue;
    }
    const backoffMinutes = RETRY_BASE_MINUTES * 2 ** (attempts - 1);
    await pool
      .query(
        `UPDATE account_media_cleanup
            SET attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' minutes')::interval
          WHERE id = $1`,
        [row.id, attempts, error.slice(0, 500), String(backoffMinutes)],
      )
      .catch((err) => logger.warn({ err, id: row.id }, "[account-cleanup] could not reschedule retry row"));
  }

  logger.info(result, "[account-cleanup] retry pass complete");
  return result;
}

/** Retry queued media deletions every 15 minutes (and once shortly after boot). */
export function scheduleAccountMediaCleanupRetries(): void {
  const intervalMs = 15 * 60 * 1000;
  const run = () =>
    retryPendingAccountMediaCleanup().catch((err) =>
      logger.warn({ err }, "[account-cleanup] retry pass failed"),
    );
  logger.info({ intervalMs }, "[account-cleanup] retry worker scheduled");
  setTimeout(run, 60_000).unref();
  setInterval(run, intervalMs).unref();
}
