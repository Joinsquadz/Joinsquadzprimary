/**
 * File storage adapter — Supabase Storage.
 *
 * Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_STORAGE_BUCKET to enable.
 * Returns null when Supabase is not configured so callers can fall back to the
 * legacy Replit Object Storage service.
 *
 * Bucket setup (do once in Supabase dashboard):
 *   1. Create a bucket named by SUPABASE_STORAGE_BUCKET (default: "squadz-media")
 *   2. Set it to "Private" — downloads are served via short-lived signed URLs
 *      so the bucket does not need to be publicly accessible.
 *   3. Add an upload policy that restricts who can write (service-role key bypasses RLS)
 */
import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import { logger } from "../lib/logger";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "squadz-media";

/**
 * Separate PUBLIC bucket for assets that must load without auth (profile avatars).
 * Avatars render through a plain <Image> with no Authorization header, so they
 * cannot be served via the auth-gated signed-URL proxy used for private assets.
 * They need a permanent, publicly-readable URL — which only works from a bucket
 * whose `public` flag is true. The private BUCKET above stays private for vault
 * photos / attachments; only avatars live here.
 */
const PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET ?? "squadz-avatars";

let publicBucketReady = false;

/**
 * Idempotently ensure the public avatar bucket exists and is public. Cached after
 * the first success so it is effectively a no-op on subsequent uploads. Self-heals
 * a missing bucket so public uploads never silently land somewhere unreadable.
 */
async function ensurePublicBucket(): Promise<boolean> {
  if (publicBucketReady || !supabaseAdmin) return publicBucketReady;
  const { error } = await supabaseAdmin.storage.createBucket(PUBLIC_BUCKET, { public: true });
  if (error && !/exist/i.test(error.message)) {
    logger.error({ err: error, bucket: PUBLIC_BUCKET }, "[storage] Failed to ensure public bucket");
    return false;
  }
  // Whether we just created it or it already existed, verify it is genuinely public.
  // A pre-existing PRIVATE bucket here would silently yield avatar URLs that 400 —
  // the exact bug we are fixing — so fail closed rather than trust "already exists".
  const { data: info, error: getErr } = await supabaseAdmin.storage.getBucket(PUBLIC_BUCKET);
  if (getErr || !info) {
    logger.error({ err: getErr, bucket: PUBLIC_BUCKET }, "[storage] Failed to read public bucket");
    return false;
  }
  if (!info.public) {
    logger.error(
      { bucket: PUBLIC_BUCKET },
      "[storage] Public avatar bucket is not public; refusing to serve avatars from it (set its public flag = true)",
    );
    return false;
  }
  publicBucketReady = true;
  return true;
}

export interface StorageUploadResult {
  uploadURL: string;
  /**
   * The objectPath to store in the DB and return to the client.
   * - For private assets (photos, attachments): `/objects/supabase/<storagePath>`
   *   — served via the auth-gated GET /storage/objects/* route using a signed URL.
   * - For public assets (profile images): the direct Supabase public URL.
   */
  objectPath: string;
  publicUrl: string;
}

/**
 * Generate a pre-signed upload URL for direct client-to-storage uploads.
 * The client PUTs the file binary to `uploadURL`.
 *
 * @param contentType   MIME type of the file being uploaded
 * @param isPublicAccess  When true (e.g. profile avatars), uploads to the PUBLIC
 *                        bucket and returns its permanent public URL as
 *                        `objectPath` so a plain <Image> (no auth header) can load
 *                        it directly. When false (default), uploads to the private
 *                        bucket and returns a protected `/objects/...` API path
 *                        served via short-lived signed-URL redirect.
 */
export async function createStorageUploadUrl(
  contentType: string,
  isPublicAccess = false,
): Promise<StorageUploadResult | null> {
  if (!supabaseAdmin) return null;

  if (isPublicAccess && !(await ensurePublicBucket())) return null;

  const bucket = isPublicAccess ? PUBLIC_BUCKET : BUCKET;
  const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
  const storagePath = `uploads/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    logger.error({ err: error }, "[storage] Failed to create Supabase signed upload URL");
    return null;
  }

  const { data: publicData } = supabaseAdmin.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  return {
    uploadURL: data.signedUrl,
    objectPath: isPublicAccess
      ? publicData.publicUrl
      : `/objects/supabase/${storagePath}`,
    publicUrl: publicData.publicUrl,
  };
}

/**
 * Create a short-lived signed download URL for a private Supabase Storage object.
 * The storagePath is the relative path inside the bucket (e.g. "uploads/uuid.jpg").
 */
export async function createStorageDownloadUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) {
    logger.error({ err: error, storagePath }, "[storage] Failed to create signed download URL");
    return null;
  }

  return data.signedUrl;
}

export function getStorageStatus(): { configured: boolean; bucket: string; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { configured: missing.length === 0, bucket: BUCKET, missing };
}
