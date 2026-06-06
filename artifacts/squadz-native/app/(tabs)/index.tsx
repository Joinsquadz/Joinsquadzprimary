import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { EventCard } from "@/components/EventCard";
import { UserAvatar } from "@/components/UserAvatar";
import { SQUADS, goingCount } from "@/data/mock";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const { events } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const memberCount = new Set(SQUADS.flatMap((s) => s.memberIds)).size;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.logoText, { color: colors.primary }]}>SquadZ</Text>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            Hey, {currentUser.name.split(" ")[0]} 👋
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/activity"); }}
            style={[styles.bellBtn, { backgroundColor: colors.card }]}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={styles.badgeText}>4</Text>
            </View>
          </TouchableOpacity>
          <UserAvatar initials={currentUser.initials} color={currentUser.color} size={38} fontSize={13} />
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100) }}
        showsVerticalScrollIndicator={false}
      >
        {/* Upcoming Events */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/events")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={events.slice(0, 3)}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(e) => e.id}
            contentContainerStyle={{ gap: 12, paddingRight: 20 }}
            renderItem={({ item }) => (
              <EventCard
                id={item.id}
                emoji={item.emoji}
                title={item.title}
                date={item.date}
                location={item.location}
                hostId={item.hostId}
                attendeeCount={goingCount(item)}
                horizontal
              />
            )}
          />
        </View>

        {/* My Squads */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My Squads</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/profile")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>Manage →</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={SQUADS}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ gap: 12, paddingRight: 20 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/squad/${item.id}`); }}
                style={[styles.squadBubble, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.squadEmoji, { backgroundColor: item.color + "20" }]}>
                  <Text style={styles.squadEmojiText}>{item.emoji}</Text>
                </View>
                <Text style={[styles.squadName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.squadCount, { color: colors.mutedForeground }]}>
                  {item.memberIds.length} members
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        {/* Quick stats */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>This Month</Text>
          <View style={styles.statsRow}>
            {[
              { value: events.length.toString(), label: "Events", color: colors.primary },
              { value: SQUADS.length.toString(), label: "Squads", color: colors.blue },
              { value: memberCount.toString(), label: "Members", color: colors.green },
            ].map((s) => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  logoText: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  greeting: { fontSize: 13, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  bellBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", position: "relative" },
  badge: {
    position: "absolute", top: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  body: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  seeAll: { fontSize: 13, fontWeight: "600" },
  squadBubble: {
    borderRadius: 16, borderWidth: 1, padding: 14, width: 140,
    alignItems: "center", gap: 8,
  },
  squadEmoji: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  squadEmojiText: { fontSize: 24 },
  squadName: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  squadCount: { fontSize: 12, textAlign: "center" },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 16, alignItems: "center", gap: 4 },
  statValue: { fontSize: 26, fontWeight: "900" },
  statLabel: { fontSize: 12 },
});
