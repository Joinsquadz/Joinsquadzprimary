import * as ImageManipulator from "expo-image-manipulator";

/**
 * Strip EXIF metadata (including GPS coordinates) from a photo by re-encoding
 * it through expo-image-manipulator. The manipulator discards all metadata when
 * it re-compresses the image.
 *
 * - Only applies to images. Videos are returned unchanged.
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
