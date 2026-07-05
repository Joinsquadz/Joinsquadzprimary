import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { conflictMessage, type PlanConflict } from "@/lib/conflicts";

/**
 * Non-blocking, private heads-up shown only to the affected user when a plan
 * overlaps with something already on their own calendar. Renders nothing when
 * there are no conflicts.
 */
export default function ConflictBanner({
  conflicts,
  style,
}: {
  conflicts: PlanConflict[];
  style?: object;
}) {
  const colors = useColors();
  const message = conflictMessage(conflicts);
  if (!message) return null;
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.gold + "16", borderColor: colors.gold + "55" },
        style,
      ]}
      accessibilityRole="alert"
    >
      <Ionicons name="alert-circle-outline" size={18} color={colors.gold} />
      <Text style={[styles.text, { color: colors.foreground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
});
