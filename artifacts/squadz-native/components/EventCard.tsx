import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useData } from "@/context/AppContext";
import { getUserById } from "@/data/mock";

interface EventCardProps {
  id: string;
  emoji: string;
  title: string;
  date: string;
  location: string;
  hostId: string;
  attendeeCount: number;
  horizontal?: boolean;
}

export function EventCard({
  id,
  emoji,
  title,
  date,
  location,
  hostId,
  attendeeCount,
  horizontal,
}: EventCardProps) {
  const colors = useColors();
  const { currentUser } = useData();
  const host = getUserById(hostId);
  const isHost = hostId === currentUser.id;

  return (
    <TouchableOpacity
      onPress={() => router.push(`/event/${id}`)}
      activeOpacity={0.75}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          width: horizontal ? 260 : undefined,
        },
      ]}
    >
      <View style={[styles.emojiWrap, { backgroundColor: colors.primary + "20" }]}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          {isHost && (
            <View style={[styles.hostBadge, { backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
              <Ionicons name="star" size={9} color={colors.gold} />
              <Text style={[styles.hostBadgeText, { color: colors.gold }]}>Host</Text>
            </View>
          )}
        </View>
        <Text style={[styles.date, { color: colors.primary }]} numberOfLines={1}>
          {date}
        </Text>
        <Text style={[styles.location, { color: colors.mutedForeground }]} numberOfLines={1}>
          {location}
        </Text>
        <View style={styles.footer}>
          <View style={[styles.hostAvatar, { backgroundColor: host.color }]}>
            <Text style={styles.hostInitials}>{host.initials}</Text>
          </View>
          <Text style={[styles.attendees, { color: colors.mutedForeground }]}>
            {attendeeCount} going
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textDim} style={styles.chevron} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  emojiWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emoji: { fontSize: 22 },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { fontSize: 15, fontWeight: "700", flexShrink: 1 },
  hostBadge: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1, flexShrink: 0 },
  hostBadgeText: { fontSize: 9, fontWeight: "800" },
  date: { fontSize: 13, fontWeight: "600" },
  location: { fontSize: 12 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  hostAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  hostInitials: { fontSize: 9, fontWeight: "800", color: "#fff" },
  attendees: { fontSize: 12 },
  chevron: { flexShrink: 0 },
});
