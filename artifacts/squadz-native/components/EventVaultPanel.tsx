import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import type { Event } from "@/types";

/**
 * Shared photo-vault entry point for an event or trip. The actual vault lives
 * at /vault?eventId=... — this is the in-screen CTA + preview grid.
 */
export function EventVaultPanel({ event }: { event: Event }) {
  const colors = useColors();
  const open = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    Haptics.impactAsync(style);
    router.push(`/vault?eventId=${event.id}&eventName=${encodeURIComponent(event.title)}` as never);
  };

  return (
    <View style={{ gap: 16 }}>
      <TouchableOpacity onPress={() => open()} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeaderRow}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>📷 Trip Vault</Text>
            <Text style={[styles.cardBody, { color: colors.foreground }]}>View all photos from {event.title}</Text>
            <Text style={[styles.cardTitle, { color: colors.mutedForeground, marginTop: 4 }]}>Stored in Photo Vault · private to squad members</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
        </View>
      </TouchableOpacity>
      <View style={styles.vaultPhotoGrid}>
        {[
          { color: "#FF6B3A", emoji: "🏖️" },
          { color: "#7B6EF6", emoji: "🍹" },
          { color: "#F5A623", emoji: "🌅" },
        ].map((p, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => open()}
            style={[styles.vaultGridCell, { backgroundColor: p.color + "30" }]}
            activeOpacity={0.8}
          >
            <Text style={styles.vaultGridEmoji}>{p.emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity
        onPress={() => open(Haptics.ImpactFeedbackStyle.Medium)}
        style={[styles.vaultCta, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
        activeOpacity={0.8}
      >
        <Ionicons name="images-outline" size={18} color={colors.primary} />
        <Text style={[styles.vaultCtaText, { color: colors.primary }]}>Open Photo Vault for this trip</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBody: { fontSize: 15, lineHeight: 22 },
  vaultPhotoGrid: { flexDirection: "row", gap: 6 },
  vaultGridCell: { flex: 1, aspectRatio: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative" },
  vaultGridEmoji: { fontSize: 28 },
  vaultCta: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  vaultCtaText: { flex: 1, fontSize: 14, fontWeight: "700" },
});
