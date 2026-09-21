import { Platform } from "react-native";

/**
 * Height of the bottom tab bar, per platform. The web tab bar is rendered
 * position:absolute (see app/(tabs)/_layout.tsx), so it overlays screen
 * content — any screen with a fixed bottom action button must reserve this
 * much space so the button is not hidden behind the tab bar.
 */
export const TAB_BAR_HEIGHT = Platform.select({ ios: 49, android: 56, web: 84, default: 49 }) ?? 49;

export const MOBILE_LAYOUT = {
  narrowBreakpoint: 375,
  screenGutter: 16,
  wideScreenGutter: 20,
  sectionGap: 16,
  cardGap: 10,
  cardPadding: 14,
  cardRadius: 14,
  controlHeight: 46,
  minTouchTarget: 44,
  titleSize: 24,
  bodySize: 14,
  captionSize: 12,
  iconSize: 18,
} as const;

export function responsiveMobileLayout(width: number) {
  const narrow = width < MOBILE_LAYOUT.narrowBreakpoint;
  return {
    narrow,
    screenGutter: narrow ? MOBILE_LAYOUT.screenGutter : MOBILE_LAYOUT.wideScreenGutter,
    sectionGap: narrow ? 14 : MOBILE_LAYOUT.sectionGap,
    cardPadding: narrow ? 12 : MOBILE_LAYOUT.cardPadding,
  };
}
