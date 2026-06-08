/**
 * File storage adapter — Supabase Storage.
 *
 * Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_STORAGE_BUCKET to enable.
 * Returns null when Supabase is not configured so callers can fall back to the
 * legacy Replit Object Storage service.
 *
 * Bucket setup (do once in Supabase dashboard):
 *   1. Create a bucket named by SUPABASE_STORAGE_BUCKET (default: "squadz-media")
 *   2. Set it to "Public" so file URLs work without signed reads
 *   3. Add an upload policy that restricts who can write (service-role key bypasses RLS)
 */
import crypto from "crypto";
import { supabaseAdmin } from "./supabase";
import { logger } from "../lib/logger";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "squadz-media";

export interface StorageUploadResult {
  uploadURL: string;
  objectPath: string;
  publicUrl: string;
}

/**
 * Generate a pre-signed upload URL for direct client-to-storage uploads.
 * The client POSTs the file binary to `uploadURL` (PUT method, Content-Type header).
 * After upload, use `publicUrl` as the permanent URL and store `objectPath` in the DB.
 */
export async function createStorageUploadUrl(
  contentType: string,
): Promise<StorageUploadResult | null> {
  if (!supabaseAdmin) return null;

  const ext = contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ?? "bin";
  const objectPath = `uploads/${crypto.randomUUID()}.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectPath);

  if (error || !data) {
    logger.error({ err: error }, "[storage] Failed to create Supabase signed upload URL");
    return null;
  }

  const { data: publicData } = supabaseAdmin.storage
    .from(BUCKET)
    .getPublicUrl(objectPath);

  return {
    uploadURL: data.signedUrl,
    objectPath,
    publicUrl: publicData.publicUrl,
  };
}

/**
 * Create a short-lived signed download URL for a private object.
 * Use this if the bucket is configured as private.
 */
export async function createStorageDownloadUrl(
  objectPath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data) {
    logger.error({ err: error, objectPath }, "[storage] Failed to create signed download URL");
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
