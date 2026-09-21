import { memo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useTimezone } from "@/context/TimezoneContext";
import type { Event } from "@/types";
import { coverFor, tripNights, isHappeningNow } from "@/lib/tripUtils";
import { MOBILE_LAYOUT } from "@/constants/layout";

function TripCardBase({ trip }: { trip: Event }) {
  const colors = useColors();
  const { formatTripDateRange } = useTimezone();
  const cover = coverFor(trip.coverStyle);
  const nights = tripNights(trip);
  const stopCount = trip.itinerary?.length ?? 0;
  const happening = isHappeningNow(trip);

  return (
    <TouchableOpacity
      onPress={() => router.push(`/trip/${trip.id}`)}
      activeOpacity={0.85}
      style={[styles.card, { borderColor: colors.border }]}
    >
      <LinearGradient
        colors={cover}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.cover}
      >
        <View style={styles.coverTopRow}>
          <Text style={styles.coverEmoji}>{trip.emoji}</Text>
          {happening ? (
            <View style={styles.nowBadge}>
              <View style={styles.nowDot} />
              <Text style={styles.nowText}>Happening now</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.coverTitle} numberOfLines={1}>{trip.title}</Text>
        <Text style={styles.coverRange}>
          {formatTripDateRange(trip)}
        </Text>
      </LinearGradient>

      <View style={[styles.meta, { backgroundColor: colors.card }]}>
        <View style={styles.metaItem}>
          <Ionicons name="moon-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {nights > 0 ? `${nights} ${nights === 1 ? "night" : "nights"}` : "Day trip"}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="list-outline" size={14} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {stopCount} {stopCount === 1 ? "stop" : "stops"}
          </Text>
        </View>
        {trip.location ? (
          <View style={[styles.metaItem, { flex: 1, justifyContent: "flex-end" }]}>
            <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {trip.location}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export const TripCard = memo(TripCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: MOBILE_LAYOUT.cardRadius,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: MOBILE_LAYOUT.cardGap,
  },
  cover: { padding: MOBILE_LAYOUT.cardPadding, minHeight: 104, justifyContent: "space-between" },
  coverTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  coverEmoji: { fontSize: 26 },
  nowBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  nowText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  coverTitle: { color: "#fff", fontSize: 18, fontWeight: "900", marginTop: 8 },
  coverRange: { color: "rgba(255,255,255,0.92)", fontSize: 13, fontWeight: "700", marginTop: 2 },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { fontSize: 12, fontWeight: "600" },
});
