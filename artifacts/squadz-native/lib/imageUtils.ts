import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { track } from "@/lib/analytics";

/**
 * Strip EXIF metadata (including GPS coordinates) from a photo by re-encoding
 * it through expo-image-manipulator. The manipulator discards all metadata when
 * it re-compresses the image.
 *
 * - Only applies to images. Non-images are returned unchanged.
 * - Output is always JPEG (mimeType "image/jpeg") regardless of input format.
 * - Retries once on failure before falling back to the original URI/mimeType
 *   (e.g. unsupported format), so a stripping failure never blocks an upload.
 * - Fires an "exif_strip_fallback" analytics event when the fallback path is
 *   taken (both attempts failed). The optional `surface` label identifies the
 *   upload entry point (e.g. "chat", "vault", "moments").
 */
export async function stripImageExif(
  uri: string,
  mimeType: string,
  surface = "unknown",
): Promise<{ uri: string; mimeType: string }> {
  const isImage = mimeType.startsWith("image/");
  if (!isImage) return { uri, mimeType };

  const attempt = () =>
    ImageManipulator.manipulateAsync(uri, [], {
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
    });

  try {
    const result = await attempt();
    return { uri: result.uri, mimeType: "image/jpeg" };
  } catch {
    // First attempt failed — retry once before giving up.
    try {
      const result = await attempt();
      return { uri: result.uri, mimeType: "image/jpeg" };
    } catch (secondErr) {
      track("exif_strip_fallback", {
        surface,
        mediaType: "image",
        error: secondErr instanceof Error ? secondErr.message : String(secondErr),
      });
      return { uri, mimeType };
    }
  }
}

/**
 * Strip GPS/device metadata from a video by re-encoding via
 * react-native-compressor. The compressor uses AVAssetExportSession (iOS) /
 * MediaCodec (Android), both of which drop container-level metadata atoms
 * (QuickTime udta/mdta, MP4 moov/udta) during transcoding.
 *
 * - No-op on web (Platform.OS === "web") — the compressor is native-only.
 * - No-op for non-video mimeTypes.
 * - Retries once on failure before falling back to the original URI/mimeType.
 *   Fires an "exif_strip_fallback" analytics event when the fallback path is
 *   taken (both attempts failed).
 */
export async function stripVideoExif(
  uri: string,
  mimeType: string,
  surface = "unknown",
): Promise<{ uri: string; mimeType: string }> {
  if (!mimeType.startsWith("video/")) return { uri, mimeType };
  if (Platform.OS === "web") return { uri, mimeType };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Video: any;
  try {
    ({ Video } = await import("react-native-compressor"));
  } catch {
    // Module unavailable (e.g. bundler misconfiguration) — fall back silently.
    return { uri, mimeType };
  }

  const attempt = () => Video.compress(uri, { compressionMethod: "auto" });

  try {
    const compressed = await attempt();
    return { uri: compressed, mimeType };
  } catch {
    // First attempt failed — retry once before giving up.
    try {
      const compressed = await attempt();
      return { uri: compressed, mimeType };
    } catch (secondErr) {
      track("exif_strip_fallback", {
        surface,
        mediaType: "video",
        error: secondErr instanceof Error ? secondErr.message : String(secondErr),
      });
      return { uri, mimeType };
    }
  }
}

/**
 * Unified metadata stripper — delegates to stripImageExif for images and
 * stripVideoExif for videos. Use this at every upload call site so that both
 * media types are covered with a single call.
 *
 * Pass `surface` to identify the upload entry point in any fallback analytics
 * event (e.g. "chat", "vault", "moments", "feed").
 */
export async function stripMediaExif(
  uri: string,
  mimeType: string,
  surface = "unknown",
): Promise<{ uri: string; mimeType: string }> {
  if (mimeType.startsWith("image/")) return stripImageExif(uri, mimeType, surface);
  if (mimeType.startsWith("video/")) return stripVideoExif(uri, mimeType, surface);
  return { uri, mimeType };
}
