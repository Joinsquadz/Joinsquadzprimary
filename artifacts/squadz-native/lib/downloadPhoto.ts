import { Platform } from "react-native";

export type DownloadResult = "saved" | "denied" | "error";

/**
 * Downloads a remote image to the user's device.
 * - Web: triggers a browser download via a temporary object URL.
 * - Native (iOS/Android): saves the image into the device photo library.
 *
 * Native-only modules are imported dynamically (and only on native) so the
 * web bundle never evaluates them — importing them statically crashes web.
 */
export async function downloadPhoto(
  url: string,
  filename: string,
  headers?: Record<string, string>,
): Promise<DownloadResult> {
  if (Platform.OS === "web") {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if (!res.ok) return "error";
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      return "saved";
    } catch {
      return "error";
    }
  }

  try {
    const FileSystem = await import("expo-file-system/legacy");
    const MediaLibrary = await import("expo-media-library");

    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) return "denied";

    const target = `${FileSystem.cacheDirectory ?? ""}${filename}`;
    const { uri } = await FileSystem.downloadAsync(url, target, headers ? { headers } : undefined);
    await MediaLibrary.saveToLibraryAsync(uri);
    return "saved";
  } catch {
    return "error";
  }
}
