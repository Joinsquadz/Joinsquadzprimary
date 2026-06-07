import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth, useData } from "@/context/AppContext";
import { EventCard } from "@/components/EventCard";
import { SkeletonBox } from "@/components/SkeletonBox";
import { goingCount, getUserById } from "@/data/mock";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type DiscoverEvent = { id: string; emoji: string; title: string; date: string; inviteCode: string };
type DiscoverSquad = { id: string; emoji: string; name: string; color: string; memberIds: string[] };

const AI_SUGGESTIONS = [
  { emoji: "🎳", title: "Bowling night this weekend", why: "Your squad hasn't hung out in 12 days", color: "#A855F7", type: "Event" },
  { emoji: "🍕", title: "Friday pizza run", why: "3 members nearby right now", color: "#FF5C3A", type: "Food" },
];

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken } = useAuth();
  const { events, squads, eventsLoading, squadsLoading, joinEvent, joinSquad } = useData();
  const [discoverEvents, setDiscoverEvents] = useState<DiscoverEvent[]>([]);
  const [discoverSquads, setDiscoverSquads] = useState<DiscoverSquad[]>([]);
  const [streaks, setStreaks] = useState<{ monthlyPlan: number; stayInTouch: number } | null>(null);
  const [fabOpen, setFabOpen] = useState(false);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/api/streaks`, { headers: buildAuthHeaders(authToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { monthlyPlan: number; stayInTouch: number } | null) => {
        if (data) setStreaks(data);
      })
      .catch(() => {});
  }, [authToken]);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/api/discover`, { headers: buildAuthHeaders(authToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { events?: DiscoverEvent[]; squads?: DiscoverSquad[] } | null) => {
        if (data) {
          setDiscoverEvents(data.events ?? []);
          setDiscoverSquads(data.squads ?? []);
        }
      })
      .catch(() => {});
  }, [authToken]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const upNext = events[0] ?? null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.foreground }]}>
            Hey, {currentUser.name.split(" ")[0]} 👋
          </Text>
          <Text style={[styles.subGreeting, { color: colors.mutedForeground }]}>
            {squads.length} squad{squads.length !== 1 ? "s" : ""} · {events.length} event{events.length !== 1 ? "s" : ""} this week
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/(tabs)/activity"); }}
            style={[styles.bellBtn, { backgroundColor: colors.card }]}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.foreground} />
            <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Text style={styles.badgeText}>4</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100) }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero "Up Next" card */}
        {eventsLoading ? (
          <View style={styles.section}>
            <SkeletonBox height={160} borderRadius={22} />
          </View>
        ) : upNext ? (
          <View style={styles.section}>
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(`/event/${upNext.id}`); }}
              activeOpacity={0.92}
            >
              <LinearGradient
                colors={["#FF5C3A", "#FF8C3A"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCard}
              >
                {/* Decorative circle */}
                <View style={styles.heroCircle} />
                <View style={[styles.heroTag, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                  <Text style={styles.heroTagText}>⚡ Up Next</Text>
                </View>
                <Text style={styles.heroTitle}>{upNext.emoji} {upNext.title}</Text>
                <Text style={styles.heroSub}>{upNext.location} · {upNext.date}</Text>
                <View style={styles.heroFooter}>
                  <View style={styles.heroPeople}>
                    {Object.entries(upNext.rsvps)
                      .filter(([, s]) => s === "going")
                      .slice(0, 5)
                      .map(([uid], i) => {
                        const u = getUserById(uid);
                        return (
                          <View key={uid} style={[styles.heroPip, { marginLeft: i > 0 ? -8 : 0, backgroundColor: u.color }]}>
                            <Text style={styles.heroPipText}>{u.initials[0]}</Text>
                          </View>
                        );
                      })}
                  </View>
                  <Text style={styles.heroGoingText}>{goingCount(upNext)} going</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Streaks */}
        {streaks !== null && (streaks.monthlyPlan > 0 || streaks.stayInTouch > 0) ? (
          <View style={[styles.section, { flexDirection: "row", gap: 12 }]}>
            {/* Monthly plan streak */}
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#FFB54740", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>🔥</Text>
                <Text style={[styles.streakCount, { color: "#FFB547" }]}>
                  {streaks.monthlyPlan > 0 ? streaks.monthlyPlan : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.monthlyPlan === 1 ? "month" : "months"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Monthly plan streak</Text>
            </View>
            {/* Stay in touch streak */}
            <View style={[styles.streakCard, { backgroundColor: colors.card, borderColor: "#4A9EFF40", flex: 1 }]}>
              <View style={styles.streakCardTop}>
                <Text style={styles.streakEmoji}>💬</Text>
                <Text style={[styles.streakCount, { color: "#4A9EFF" }]}>
                  {streaks.stayInTouch > 0 ? streaks.stayInTouch : "—"}
                </Text>
              </View>
              <Text style={[styles.streakLabel, { color: colors.foreground }]}>
                {streaks.stayInTouch === 1 ? "week" : "weeks"}
              </Text>
              <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Stay-in-touch streak</Text>
            </View>
          </View>
        ) : streaks !== null ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.streakNudge, { backgroundColor: colors.card, borderColor: "#FFB54740" }]}
              onPress={() => {
                router.push("/(tabs)/create");
              }}
            >
              <Text style={styles.streakEmoji}>🔥</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.streakLabel, { color: colors.foreground }]}>Start your streak</Text>
                <Text style={[styles.streakSub, { color: colors.mutedForeground }]}>Plan something with your squad this month</Text>
              </View>
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>+</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* My Squads */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>My SquadZ</Text>
            {!squadsLoading && (
              <TouchableOpacity onPress={() => router.push("/(tabs)/squads")}>
                <Text style={[styles.seeAll, { color: colors.primary }]}>See all →</Text>
              </TouchableOpacity>
            )}
          </View>
          {squadsLoading ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {[130, 130, 130].map((w, i) => (
                <SkeletonBox key={i} width={w} height={120} borderRadius={16} />
              ))}
            </View>
          ) : (
            <FlatList
              data={squads}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(s) => s.id}
              contentContainerStyle={{ gap: 10, paddingRight: 20 }}
              ListFooterComponent={
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/squad/create"); }}
                  style={[styles.squadBubble, styles.newSquadBubble, { borderColor: colors.primary + "50" }]}
                >
                  <View style={[styles.squadEmoji, { backgroundColor: colors.primary + "20" }]}>
                    <Ionicons name="add" size={26} color={colors.primary} />
                  </View>
                  <Text style={[styles.squadName, { color: colors.primary }]}>New</Text>
                </TouchableOpacity>
              }
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
          )}
        </View>

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

        {/* AI Suggestions */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>✦ AI Suggestions</Text>
          <View style={{ gap: 10 }}>
            {AI_SUGGESTIONS.map((s) => (
              <TouchableOpacity
                key={s.title}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/(tabs)/create",
                    params: { prefillTitle: s.title, prefillEmoji: s.emoji },
                  });
                }}
                style={[styles.suggestionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.suggestionIcon, { backgroundColor: s.color + "22" }]}>
                  <Text style={{ fontSize: 22 }}>{s.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>{s.title}</Text>
                  <Text style={[styles.suggestionSub, { color: colors.mutedForeground }]}>{s.why}</Text>
                </View>
                <View style={[styles.suggestionTag, { backgroundColor: s.color + "22" }]}>
                  <Text style={[styles.suggestionTagText, { color: s.color }]}>{s.type}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Discover */}
        {(discoverEvents.length > 0 || discoverSquads.length > 0) && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>🔍 Discover</Text>
                <Text style={[styles.discoverSubtitle, { color: colors.mutedForeground }]}>Public events & squads to join</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
              {discoverEvents.map((ev) => (
                <TouchableOpacity
                  key={ev.id}
                  style={[styles.discoverCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    await joinEvent(ev.inviteCode);
                    router.push(`/event/${ev.id}` as never);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={[styles.discoverIconWrap, { backgroundColor: colors.primary + "18" }]}>
                    <Text style={styles.discoverEmoji}>{ev.emoji}</Text>
                  </View>
                  <Text style={[styles.discoverTitle, { color: colors.foreground }]} numberOfLines={2}>{ev.title}</Text>
                  <Text style={[styles.discoverSub, { color: colors.mutedForeground }]} numberOfLines={1}>{ev.date}</Text>
                  <View style={[styles.discoverJoinBtn, { backgroundColor: colors.primary }]}>
                    <Text style={styles.discoverJoinText}>Join →</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {discoverSquads.map((sq) => (
                <TouchableOpacity
                  key={sq.id}
                  style={[styles.discoverCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    await joinSquad(sq.id);
                    router.push(`/squad/${sq.id}` as never);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={[styles.discoverIconWrap, { backgroundColor: (sq.color ?? colors.primary) + "22" }]}>
                    <Text style={styles.discoverEmoji}>{sq.emoji}</Text>
                  </View>
                  <Text style={[styles.discoverTitle, { color: colors.foreground }]} numberOfLines={2}>{sq.name}</Text>
                  <Text style={[styles.discoverSub, { color: colors.mutedForeground }]}>{sq.memberIds?.length ?? 0} members</Text>
                  <View style={[styles.discoverJoinBtn, { backgroundColor: sq.color ?? colors.primary }]}>
                    <Text style={styles.discoverJoinText}>Join →</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      {/* FAB speed-dial backdrop */}
      {fabOpen && (
        <TouchableOpacity
          style={styles.fabBackdrop}
          activeOpacity={1}
          onPress={() => setFabOpen(false)}
        />
      )}

      {/* FAB speed-dial */}
      <View style={styles.fabGroup}>
        {fabOpen && (
          <>
            <View style={styles.fabOption}>
              <View style={[styles.fabOptionLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.fabOptionText, { color: colors.foreground }]}>New Squad</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setFabOpen(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/squad/create" as never);
                }}
                style={[styles.fabMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={{ fontSize: 22 }}>👥</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fabOption}>
              <View style={[styles.fabOptionLabel, { backgroundColor: colors.card }]}>
                <Text style={[styles.fabOptionText, { color: colors.foreground }]}>New Event</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setFabOpen(false);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push("/(tabs)/create" as never);
                }}
                style={[styles.fabMini, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={{ fontSize: 22 }}>🎉</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setFabOpen((v) => !v);
          }}
          style={[styles.fab, { backgroundColor: colors.primary, shadowColor: colors.primary }]}
        >
          <Text style={[styles.fabText, fabOpen && { transform: [{ rotate: "45deg" }] }]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1,
  },
  greeting: { fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  subGreeting: { fontSize: 13, marginTop: 2 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  badge: {
    position: "absolute", top: -2, right: -2,
    width: 18, height: 18, borderRadius: 9,
    alignItems: "center", justifyContent: "center", borderWidth: 2,
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: "#fff" },
  body: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  seeAll: { fontSize: 13, fontWeight: "600" },
  heroCard: {
    borderRadius: 22, padding: 20, overflow: "hidden",
  },
  heroCircle: {
    position: "absolute", right: -30, top: -30,
    width: 160, height: 160, borderRadius: 80,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  heroTag: {
    alignSelf: "flex-start", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  heroTagText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  heroTitle: { fontSize: 22, fontWeight: "800", color: "#fff", marginBottom: 4 },
  heroSub: { fontSize: 13, color: "rgba(255,255,255,0.8)", marginBottom: 14 },
  heroFooter: { flexDirection: "row", alignItems: "center" },
  heroPeople: { flexDirection: "row" },
  heroPip: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#FF5C3A",
  },
  heroPipText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  heroGoingText: { marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.8)" },
  streakCard: {
    borderRadius: 16, borderWidth: 1.5, padding: 16, gap: 4,
  },
  streakCardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  streakEmoji: { fontSize: 22 },
  streakCount: { fontSize: 28, fontWeight: "900" },
  streakLabel: { fontSize: 13, fontWeight: "700" },
  streakSub: { fontSize: 11, marginTop: 1 },
  streakNudge: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1.5, padding: 16,
  },
  squadBubble: {
    borderRadius: 16, borderWidth: 1, padding: 14, width: 130,
    alignItems: "center", gap: 8,
  },
  newSquadBubble: { borderStyle: "dashed", justifyContent: "center" },
  squadEmoji: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  squadEmojiText: { fontSize: 24 },
  squadName: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  squadCount: { fontSize: 12, textAlign: "center" },
  suggestionCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    borderRadius: 16, borderWidth: 1, padding: 14,
  },
  suggestionIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  suggestionTitle: { fontSize: 15, fontWeight: "700" },
  suggestionSub: { fontSize: 12, marginTop: 2 },
  suggestionTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  suggestionTagText: { fontSize: 11, fontWeight: "700" },
  discoverSubtitle: { fontSize: 12, marginTop: 2 },
  discoverCard: {
    width: 152, borderRadius: 16, borderWidth: 1, padding: 14,
    gap: 8, justifyContent: "space-between",
  },
  discoverIconWrap: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  discoverEmoji: { fontSize: 22 },
  discoverTitle: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
  discoverSub: { fontSize: 12 },
  discoverJoinBtn: { borderRadius: 10, paddingVertical: 7, alignItems: "center" },
  discoverJoinText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  fabBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  fabGroup: {
    position: "absolute", bottom: 90, right: 24,
    alignItems: "flex-end", gap: 14, zIndex: 11,
  },
  fabOption: { flexDirection: "row", alignItems: "center", gap: 10 },
  fabOptionLabel: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
  },
  fabOptionText: { fontSize: 13, fontWeight: "700" },
  fabMini: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center", borderWidth: 1.5,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8,
  },
  fabText: { fontSize: 26, color: "#fff", lineHeight: 30 },
});
