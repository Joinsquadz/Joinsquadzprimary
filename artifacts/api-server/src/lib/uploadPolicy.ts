export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/mov",
]);

export function validateUploadMetadata(size: number, contentType: string): {
  status: 400 | 413;
  error: string;
} | null {
  if (size > MAX_UPLOAD_BYTES) {
    return {
      status: 413,
      error: "File too large. Photos and videos must be 500 MB or smaller.",
    };
  }
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(contentType)) {
    return {
      status: 400,
      error: "Unsupported file type. Only photos (JPEG, PNG, HEIC, WebP) and videos (MP4, MOV) are allowed.",
    };
  }
  return null;
}