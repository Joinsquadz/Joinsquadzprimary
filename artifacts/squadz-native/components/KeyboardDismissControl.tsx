import { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type KeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

/**
 * A single, predictable exit from the software keyboard for every native
 * text-entry surface. It is rendered above the root navigator, so sheets,
 * modals, inline fields, and composers all get the same visible Done control.
 */
export function KeyboardDismissControl() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;

    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = (event: KeyboardEvent) => setKeyboardHeight(event.endCoordinates.height);
    const hide = () => setKeyboardHeight(0);
    const showSubscription = Keyboard.addListener(showEvent, show);
    const hideSubscription = Keyboard.addListener(hideEvent, hide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (Platform.OS === "web" || keyboardHeight === 0) return null;

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.layer]}>
      <TouchableOpacity
        onPress={Keyboard.dismiss}
        style={[
          styles.button,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            // iOS keeps the root behind the keyboard; Android generally resizes
            // it, so only iOS needs the measured keyboard offset.
            bottom: (Platform.OS === "ios" ? keyboardHeight : 0) + Math.max(insets.bottom, 10) + 8,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Done typing"
      >
        <Text style={[styles.label, { color: colors.primary }]}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sit above sibling modal overlays. In React Native later siblings paint on
  // top, so the control is also rendered as the LAST child of each Modal; the
  // explicit zIndex/elevation keeps it above overlays that set their own.
  layer: { zIndex: 9999, elevation: 24 },
  button: {
    position: "absolute",
    right: 16,
    minWidth: 64,
    minHeight: 36,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  label: { fontSize: 14, fontWeight: "800" },
});