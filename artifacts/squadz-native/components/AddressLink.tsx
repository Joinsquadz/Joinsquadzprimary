import React, { useRef } from "react";
import { Text, TouchableOpacity, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useToast } from "@/context/ToastContext";
import { openMaps, copyAddress } from "@/lib/mapLink";

type Props = {
  /** Freeform address / location string. */
  location: string;
  /** Style for the address text. */
  textStyle?: StyleProp<TextStyle>;
  /** Style for the tappable row wrapper. */
  style?: StyleProp<ViewStyle>;
  /** Leading navigate icon color (also used for the trailing chevron). */
  iconColor?: string;
  iconSize?: number;
  numberOfLines?: number;
  /** Hide the leading navigate icon (e.g. dense list rows). */
  hideIcon?: boolean;
};

/**
 * A location/address rendered as a tappable link: tap opens the platform maps
 * app for directions; long-press copies the address to the clipboard. Used for
 * event locations and trip stop addresses so members can navigate without
 * retyping. Renders nothing for a blank/`TBD` location.
 */
export default function AddressLink({
  location,
  textStyle,
  style,
  iconColor = "#fff",
  iconSize = 13,
  numberOfLines = 2,
  hideIcon = false,
}: Props) {
  const { showToast } = useToast();
  // A long-press also fires onPress on release in RN; this flag suppresses the
  // "open maps" tap when the gesture was actually a copy long-press.
  const didLongPress = useRef(false);
  const trimmed = (location ?? "").trim();
  if (!trimmed || trimmed === "TBD") return null;

  const onOpen = () => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openMaps(trimmed);
  };
  const onCopy = async () => {
    didLongPress.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const ok = await copyAddress(trimmed);
    if (ok) showToast("Address copied");
  };

  return (
    <TouchableOpacity
      onPress={onOpen}
      onLongPress={onCopy}
      delayLongPress={300}
      style={[styles.row, style]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${trimmed} in maps. Long press to copy the address.`}
      accessibilityHint="Opens directions in your maps app"
    >
      {hideIcon ? null : <Ionicons name="navigate" size={iconSize} color={iconColor} />}
      <Text style={[styles.text, textStyle]} numberOfLines={numberOfLines}>
        {trimmed}
      </Text>
      <Ionicons name="chevron-forward" size={iconSize - 1} color={iconColor} style={styles.chevron} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 5 },
  text: { flexShrink: 1 },
  chevron: { opacity: 0.7 },
});
