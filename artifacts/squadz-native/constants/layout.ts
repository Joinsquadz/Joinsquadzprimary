import { Platform } from "react-native";

/**
 * Height of the bottom tab bar, per platform. The web tab bar is rendered
 * position:absolute (see app/(tabs)/_layout.tsx), so it overlays screen
 * content — any screen with a fixed bottom action button must reserve this
 * much space so the button is not hidden behind the tab bar.
 */
export const TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 56, web: 84, default: 49 }) ?? 49;
