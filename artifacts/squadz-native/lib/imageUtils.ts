import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";

/**
 * Strip EXIF metadata (including GPS coordinates) from a photo by re-encoding
 * it through expo-image-manipulator. The manipulator discards all metadata when
 * it re-compresses the image.
 *
 * - Only applies to images. Non-images are returned unchanged.
 * - Output is always JPEG (mimeType "image/jpeg") regardless of input format.
 * - Falls back to the original URI/mimeType if stripping fails (e.g. unsupported
 *   format), so a stripping failure never blocks an upload.
 */
export async function stripImageExif(
  uri: string,
  mimeType: string,
): Promise<{ uri: string; mimeType: string }> {
  const isImage = mimeType.startsWith("image/");
  if (!isImage) return { uri, mimeType };

  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
    );
    return { uri: result.uri, mimeType: "image/jpeg" };
  } catch {
    return { uri, mimeType };
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
 * - Falls back to the original URI/mimeType on any error so a compression
 *   failure never blocks an upload.
 */
export async function stripVideoExif(
  uri: string,
  mimeType: string,
): Promise<{ uri: string; mimeType: string }> {
  if (!mimeType.startsWith("video/")) return { uri, mimeType };
  if (Platform.OS === "web") return { uri, mimeType };

  try {
    const { Video } = await import("react-native-compressor");
    const compressed = await Video.compress(uri, { compressionMethod: "auto" });
    return { uri: compressed, mimeType };
  } catch {
    return { uri, mimeType };
  }
}

/**
 * Unified metadata stripper — delegates to stripImageExif for images and
 * stripVideoExif for videos. Use this at every upload call site so that both
 * media types are covered with a single call.
 */
export async function stripMediaExif(
  uri: string,
  mimeType: string,
): Promise<{ uri: string; mimeType: string }> {
  if (mimeType.startsWith("image/")) return stripImageExif(uri, mimeType);
  if (mimeType.startsWith("video/")) return stripVideoExif(uri, mimeType);
  return { uri, mimeType };
}
