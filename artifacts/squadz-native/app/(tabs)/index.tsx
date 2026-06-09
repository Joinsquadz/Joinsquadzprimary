import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
  Share,
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
import { goingCount } from "@/lib/eventUtils";
import { useUserCache } from "@/context/UserCacheContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type DiscoverEvent = { id: string; emoji: string; title: string; date: string; inviteCode: string };
type DiscoverSquad = { id: string; emoji: string; name: string; color: string; memberIds: string[] };

type SuggestionAction =
  | { kind: "create-squad" }
  | { kind: "create-event"; squadId?: string; squadName?: string; prefillTitle?: string; prefillEmoji?: string }
  | { kind: "open-event"; eventId: string };

type Suggestion = {
  id: string;
  emoji: string;
  title: string;
  why: string;
  type: string;
  action: SuggestionAction;
};

const SUGGESTION_COLORS: Record<string, string> = {
  Plan: "#A855F7",
  RSVP: "#FF5C3A",
  Squad: "#22C55E",
};
const suggestionColor = (type: string) => SUGGESTION_COLORS[type] ?? "#A855F7";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, authToken } = useAuth();
  const { events, squads, eventsLoading, squadsLoading, joinEvent, joinSquad, friendCode } = useData();
  const [coachDismissed, setCoachDismissed] = useState(false);
  const [discoverEvents, setDiscoverEvents] = useState<DiscoverEvent[]>([]);
  const [discoverSquads, setDiscoverSquads] = useState<DiscoverSquad[]>([]);
  const [streaks, setStreaks] = useState<{ monthlyPlan: number; stayInTouch: number } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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

  useEffect(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/api/suggestions`, { headers: buildAuthHeaders(authToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Suggestion[] | null) => {
        if (Array.isArray(data)) setSuggestions(data);
      })
      .catch(() => {});
  }, [authToken, events, squads]);

  const { resolveUser, prefetchUsers } = useUserCache();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const upNext = events[0] ?? null;

  const handleFindTime = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (squads.length === 0) {
      router.push("/squad/create" as never);
      return;
    }
    router.push({ pathname: "/availability", params: { squadId: squads[0].id } } as never);
  };

  const handleInvite = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const firstSquad = squads[0];
    const message = firstSquad
      ? `Join my squad "${firstSquad.emoji} ${firstSquad.name}" on Squadz — let's find a time we're all actually free 🎉\n${firstSquad.inviteCode ? `https://joinsquadz.com/squad/join?code=${firstSquad.inviteCode}` : `https://joinsquadz.com/squad/${firstSquad.id}`}`
      : `I'm on Squadz — let's plan our next hangout and find a time everyone's free. Add me with my code ${friendCode}\nhttps://joinsquadz.com`;
    try {
      await Share.share({ message });
    } catch {
      // user dismissed the share sheet
    }
  };

  // Pre-load user profiles shown in the hero card RSVP pips
  useEffect(() => {
    if (!upNext) return;
    prefetchUsers(Object.keys(upNext.rsvps));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upNext?.id]);

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
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100) }}
        showsVerticalScrollIndicator={false}
      >
        {/* First-run coach mark */}
        {squads.length === 0 && !coachDismissed && (
          <View style={styles.section}>
            <View style={[styles.coach, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
              <Text style={styles.coachEmoji}>💡</Text>
              <Text style={[styles.coachText, { color: colors.foreground }]}>
                New here? Create a squad, invite your crew, and Squadz finds the time everyone's free.
              </Text>
              <TouchableOpacity onPress={() => setCoachDismissed(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Quick actions — always-present primary actions */}
        <View style={[styles.section, { flexDirection: "row", gap: 12 }]}>
          <TouchableOpacity
            onPress={handleFindTime}
            activeOpacity={0.85}
            style={[styles.quickAction, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}
          >
            <View style={[styles.quickIcon, { backgroundColor: colors.primary + "22" }]}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
            </View>
            <Text style={[styles.quickTitle, { color: colors.foreground }]}>Find a time</Text>
            <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>When's everyone free?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { void handleInvite(); }}
            activeOpacity={0.85}
            style={[styles.quickAction, { backgroundColor: "#2ECC8A12", borderColor: "#2ECC8A30" }]}
          >
            <View style={[styles.quickIcon, { backgroundColor: "#2ECC8A22" }]}>
              <Ionicons name="person-add" size={20} color="#2ECC8A" />
            </View>
            <Text style={[styles.quickTitle, { color: colors.foreground }]}>Invite crew</Text>
            <Text style={[styles.quickSub, { color: colors.mutedForeground }]}>Better with friends</Text>
          </TouchableOpacity>
        </View>

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
                        const u = resolveUser(uid);
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
        ) : (
          <View style={styles.section}>
            <View style={[styles.emptyHero, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={styles.emptyHeroEmoji}>{squads.length === 0 ? "👋" : "🗓️"}</Text>
              <Text style={[styles.emptyHeroTitle, { color: colors.foreground }]}>
                {squads.length === 0 ? "Let's get your crew together" : "No plans yet — start one"}
              </Text>
              <Text style={[styles.emptyHeroSub, { color: colors.mutedForeground }]}>
                {squads.length === 0
                  ? "Create a squad and invite your friends to find the time everyone's free."
                  : "Pick a time everyone's free, then turn it into a plan."}
              </Text>
              <TouchableOpacity
                onPress={squads.length === 0 ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/squad/create" as never); } : handleFindTime}
                activeOpacity={0.9}
                style={{ width: "100%" }}
              >
                <LinearGradient colors={["#FF5C3A", "#FF8C3A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.emptyHeroBtn}>
                  <Text style={styles.emptyHeroBtnText}>{squads.length === 0 ? "Create your first squad" : "Find a time"}</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
                router.push("/create" as never);
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
            <TouchableOpacity onPress={() => router.navigate("/(tabs)/events")}>
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

        {/* For You — live, data-driven suggestions */}
        {suggestions.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 12 }]}>✦ For You</Text>
            <View style={{ gap: 10 }}>
              {suggestions.map((s) => {
                const color = suggestionColor(s.type);
                return (
                  <TouchableOpacity
                    key={s.id}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const a = s.action;
                      if (a.kind === "create-squad") {
                        router.push("/squad/create");
                      } else if (a.kind === "open-event") {
                        router.push(`/event/${a.eventId}`);
                      } else {
                        router.push({
                          pathname: "/create",
                          params: {
                            ...(a.prefillTitle ? { prefillTitle: a.prefillTitle } : {}),
                            ...(a.prefillEmoji ? { prefillEmoji: a.prefillEmoji } : {}),
                            ...(a.squadId ? { prefillSquad: a.squadId } : {}),
                          },
                        } as never);
                      }
                    }}
                    style={[styles.suggestionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.suggestionIcon, { backgroundColor: color + "22" }]}>
                      <Text style={{ fontSize: 22 }}>{s.emoji}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.suggestionTitle, { color: colors.foreground }]}>{s.title}</Text>
                      <Text style={[styles.suggestionSub, { color: colors.mutedForeground }]}>{s.why}</Text>
                    </View>
                    <View style={[styles.suggestionTag, { backgroundColor: color + "22" }]}>
                      <Text style={[styles.suggestionTagText, { color }]}>{s.type}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

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
                  router.push("/create" as never);
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
  body: { flex: 1 },
  section: { paddingHorizontal: 20, paddingTop: 20 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  seeAll: { fontSize: 13, fontWeight: "600" },
  coach: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  coachEmoji: { fontSize: 18 },
  coachText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  quickAction: {
    flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, gap: 6,
  },
  quickIcon: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: "center", justifyContent: "center", marginBottom: 2,
  },
  quickTitle: { fontSize: 15, fontWeight: "800" },
  quickSub: { fontSize: 12 },
  emptyHero: {
    borderRadius: 22, borderWidth: 1, padding: 22, alignItems: "center", gap: 8,
  },
  emptyHeroEmoji: { fontSize: 36 },
  emptyHeroTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyHeroSub: { fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 8 },
  emptyHeroBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  emptyHeroBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
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
