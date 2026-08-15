import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

type Props = {
  /** Style for the full-screen overlay/backdrop that anchors the sheet. */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * The overlay root for any `Modal` that contains a text input.
 *
 * A React Native `Modal` is presented in its OWN native window, so the
 * screen-level keyboard avoidance (the `KeyboardAvoidingView` wrapping a
 * screen) has no effect on anything inside it. Bottom-anchored sheets
 * therefore stay pinned to the bottom of the screen and the keyboard covers
 * the very fields being typed into.
 *
 * This wrapper measures its own frame against the keyboard, so it is correct
 * on both platforms: on iOS it pads the sheet up by the covered amount, and on
 * Android it shrinks to the visible area. If the Android window already
 * resized itself for the keyboard, the measured overlap is zero and this is a
 * no-op rather than double-counting.
 *
 * Sheets used with this wrapper must be able to shrink — use a percentage
 * `maxHeight` on the card and `flexShrink: 1` on its scroll area. A fixed
 * pixel `maxHeight` cannot shrink, so the top of the sheet gets pushed off
 * screen once the keyboard is up.
 */
export function KeyboardAvoidingSheet({ style, children }: Props) {
  if (Platform.OS === "web") {
    return <View style={style}>{children}</View>;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
      style={style}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
