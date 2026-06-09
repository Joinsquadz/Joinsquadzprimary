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
 * @param isPublicAccess  When true (e.g. profile images), returns the Supabase
 *                        public URL as `objectPath` so it can be used directly
 *                        without going through the auth-gated storage proxy.
 *                        When false (default), returns a protected API path.
 */
export async function createStorageUploadUrl(
  contentType: string,
  isPublicAccess = false,
): Promise<StorageUploadResult | null> {
  if (!supabaseAdmin) return null;

  const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
  const storagePath = `uploads/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    logger.error({ err: error }, "[storage] Failed to create Supabase signed upload URL");
    return null;
  }

  const { data: publicData } = supabaseAdmin.storage
    .from(BUCKET)
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
