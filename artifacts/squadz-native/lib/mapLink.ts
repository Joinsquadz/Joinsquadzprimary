import { Linking, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";

/**
 * Build a platform-appropriate maps URL for a freeform location/address string.
 * iOS → Apple Maps, Android → the `geo:` scheme (opens the user's default maps
 * app), web/other → a Google Maps search URL. `os` is injectable for testing.
 */
export function mapsUrl(location: string, os: typeof Platform.OS = Platform.OS): string {
  const q = encodeURIComponent(location.trim());
  if (os === "ios") return `http://maps.apple.com/?q=${q}`;
  if (os === "android") return `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Open the platform maps app pointed at a freeform location string. No-op if blank. */
export function openMaps(location: string): void {
  if (!location || !location.trim()) return;
  Linking.openURL(mapsUrl(location)).catch(() => {});
}

/** Copy an address to the clipboard. Returns whether it was copied (false if blank/failed). */
export async function copyAddress(location: string): Promise<boolean> {
  if (!location || !location.trim()) return false;
  try {
    await Clipboard.setStringAsync(location.trim());
    return true;
  } catch {
    return false;
  }
}
