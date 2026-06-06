import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { UserAvatar } from "@/components/UserAvatar";
import { EventCard } from "@/components/EventCard";
import { getSquadById, getUserById, EVENTS } from "@/data/mock";

export default function SquadDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const btnTop = topPad + 8;

  const squad = getSquadById(id ?? "s1");

  if (!squad) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Text style={{ color: colors.foreground, textAlign: "center", marginTop: 80 }}>Squad not found</Text>
      </View>
    );
  }

  const members = squad.memberIds.map(getUserById);
  const squadEvents = EVENTS.filter((e) => e.squadId === squad.id);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Hero */}
      <View style={[styles.hero, { backgroundColor: squad.color, paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { top: btnTop }]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.heroEmoji}>{squad.emoji}</Text>
        <Text style={styles.heroName}>{squad.name}</Text>
        <Text style={styles.heroMeta}>{members.length} members</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Members */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Members</Text>
        <View style={styles.membersGrid}>
          {members.map((m) => (
            <View key={m.id} style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <UserAvatar initials={m.initials} color={m.color} size={44} fontSize={15} />
              <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
                {m.name.split(" ")[0]}
              </Text>
            </View>
          ))}
          <TouchableOpacity
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            style={[styles.memberCard, styles.addMember, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.addIcon, { backgroundColor: colors.primary + "20" }]}>
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.memberName, { color: colors.primary }]}>Invite</Text>
          </TouchableOpacity>
        </View>

        {/* Events */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 24 }]}>Events</Text>
        {squadEvents.length === 0 ? (
          <View style={styles.emptyEvents}>
            <Ionicons name="calendar-outline" size={36} color={colors.textDim} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No events yet</Text>
          </View>
        ) : (
          squadEvents.map((e) => (
            <EventCard
              key={e.id}
              id={e.id}
              emoji={e.emoji}
              title={e.title}
              date={e.date}
              location={e.location}
              hostId={e.hostId}
              attendeeCount={e.attendeeIds.length}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { paddingHorizontal: 20, paddingBottom: 24, alignItems: "center", position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 16, padding: 8 },
  heroEmoji: { fontSize: 52, marginTop: 12, marginBottom: 8 },
  heroName: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center" },
  heroMeta: { fontSize: 14, color: "rgba(255,255,255,0.8)", marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12 },
  membersGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  memberCard: { borderRadius: 14, borderWidth: 1, padding: 14, alignItems: "center", gap: 8, width: "30%" },
  addMember: {},
  addIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  memberName: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  emptyEvents: { alignItems: "center", paddingTop: 24, gap: 8 },
  emptyText: { fontSize: 14 },
});
