import { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { router, useFocusEffect } from "expo-router";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth, dbEventToEvent } from "@/context/AppContext";
import { EventCard } from "@/components/EventCard";
import { TripCard } from "@/components/TripCard";
import type { Event } from "@/types";
import { goingCount, parseEventDate } from "@/lib/eventUtils";
import { isTripPast, isHappeningNow } from "@/lib/tripUtils";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { Image } from "expo-image";
// Shared auth-race guard (see lib/vaultAuthRace.ts). This screen has its own
// events fetch (includePast), so a cold-start / slow-login 401 here must keep it
// loading + retrying instead of flashing the "No trips/events yet" empty state.
import {
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  vaultRenderMode,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

// T210: session-level cache of past-plan photo thumbnails so scrolling the Past
// list doesn't refetch the vault for every card remount.
const pastPhotoCache = new Map<string, string[]>();

function PastPhotoStrip({ eventId }: { eventId: string }) {
  const { authToken } = useAuth();
  const [urls, setUrls] = useState<string[] | null>(pastPhotoCache.get(eventId) ?? null);

  useEffect(() => {
    if (pastPhotoCache.has(eventId) || !authToken) return;
    let active = true;
    fetch(`${API_BASE}/api/vault/photos?eventId=${eventId}`, { headers: buildAuthHeaders(authToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { photos?: { url: string; mediaType?: string }[] } | null) => {
        const imgs = (data?.photos ?? [])
          .filter((p) => p.mediaType !== "video")
          .slice(0, 4)
          .map((p) => `${API_BASE}/api/storage${p.url}`);
        pastPhotoCache.set(eventId, imgs);
        if (active) setUrls(imgs);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [eventId, authToken]);

  if (!urls || urls.length === 0) return null;
  const headers = buildAuthHeaders(authToken) as Record<string, string>;
  return (
    <View style={styles.pastStrip}>
      {urls.map((uri) => (
        <Image
          key={uri}
          source={{ uri, headers }}
          style={styles.pastStripThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={uri}
          transition={150}
        />
      ))}
    </View>
  );
}

type Segment = "trips" | "events" | "past";
const SEGMENTS: { key: Segment; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "trips", label: "Trips", icon: "airplane-outline" },
  { key: "events", label: "Events", icon: "calendar-outline" },
  { key: "past", label: "Past", icon: "time-outline" },
];

function JoinCodeModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { joinEvent } = useData();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "joined" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<TextInput>(null);

  const handleClose = () => {
    setCode("");
    setStatus("idle");
    setErrorMsg("");
    onClose();
  };

  const handleJoin = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStatus("loading");
    setErrorMsg("");
    const result = await joinEvent(trimmed);
    if (result.error) {
      setStatus("error");
      setErrorMsg(result.error);
    } else {
      setStatus("joined");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlay}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={handleClose} activeOpacity={1} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 24,
            },
          ]}
        >
          <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

          {status === "joined" ? (
            <View style={styles.successContent}>
              <View style={[styles.successIcon, { backgroundColor: colors.green + "22" }]}>
                <Ionicons name="checkmark-circle" size={52} color={colors.green} />
              </View>
              <Text style={[styles.successTitle, { color: colors.foreground }]}>You're in!</Text>
              <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                It was added to your list.
              </Text>
              <TouchableOpacity
                onPress={handleClose}
                style={[styles.joinBtn, { backgroundColor: colors.primary, marginTop: 20 }]}
              >
                <Text style={styles.joinBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Join with a code</Text>
              <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>
                Enter the invite code shared with you (e.g. SQ-AB12)
              </Text>

              <View
                style={[
                  styles.codeInputRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: errorMsg ? colors.primary : colors.border,
                  },
                ]}
              >
                <Ionicons name="ticket-outline" size={20} color={colors.mutedForeground} style={{ marginRight: 8 }} />
                <TextInput
                  ref={inputRef}
                  value={code}
                  onChangeText={(t) => {
                    setCode(t.toUpperCase());
                    if (errorMsg) setErrorMsg("");
                    if (status === "error") setStatus("idle");
                  }}
                  placeholder="SQ-AB12"
                  placeholderTextColor={colors.textDim}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  returnKeyType="go"
                  onSubmitEditing={() => void handleJoin()}
                  style={[styles.codeInput, { color: colors.foreground }]}
                  editable={status !== "loading"}
                  autoFocus
                />
                {code.length > 0 && status !== "loading" && (
                  <TouchableOpacity onPress={() => { setCode(""); setErrorMsg(""); }}>
                    <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>

              {errorMsg ? (
                <View style={styles.errorRow}>
                  <Ionicons name="warning-outline" size={14} color={colors.primary} />
                  <Text style={[styles.errorText, { color: colors.primary }]}>{errorMsg}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={() => void handleJoin()}
                disabled={status === "loading" || !code.trim()}
                style={[
                  styles.joinBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: status === "loading" || !code.trim() ? 0.5 : 1,
                    marginTop: 16,
                  },
                ]}
              >
                {status === "loading" ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.joinBtnText}>Join →</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function PlansScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { joinEvent } = useData();
  const { authToken, isAuthRestoring } = useAuth();
  const [segment, setSegment] = useState<Segment>("trips");
  const [search, setSearch] = useState("");
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // The hub aggregates upcoming AND past plans across every squad, so it keeps
  // its own list (AppContext.events stays upcoming-only for Home etc.).
  const [allPlans, setAllPlans] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  // Pagination state: server pages 100 items at a time.
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // Auth-race guard for the cold-start fetch (see lib/vaultAuthRace.ts).
  const [authRace, setAuthRace] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);

  const load = useCallback(async () => {
    if (!authToken) {
      // No token yet. If auth is still restoring, this is the slow-login race —
      // stay pending (loading) and let the retry driver re-run once it lands,
      // rather than dropping to a false empty state. If we're genuinely logged
      // out, just stop loading.
      if (isAuthRestoring) {
        setAuthRace(prev => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
      } else {
        setLoading(false);
      }
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/events?includePast=1&limit=100`, { headers: buildAuthHeaders(authToken) });
      if (res.status === 401) {
        setAuthRace(prev => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
        return;
      }
      if (!res.ok) {
        setAuthRace(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
        return;
      }
      const data = (await res.json()) as Record<string, unknown>[];
      setAllPlans(data.map(dbEventToEvent));
      setHasMore(res.headers.get("X-Has-More") === "1");
      setNextOffset(data.length);
      setAuthRace(prev => applyVaultFetchOutcome(prev, { kind: "ok" }));
    } catch {
      // Keep whatever is already shown; pull-to-refresh can retry.
      setAuthRace(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
    } finally {
      setLoading(false);
    }
  }, [authToken, isAuthRestoring]);

  const loadMore = useCallback(async () => {
    if (!authToken || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/events?includePast=1&limit=100&offset=${nextOffset}`,
        { headers: buildAuthHeaders(authToken) },
      );
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>[];
      setAllPlans(prev => [...prev, ...data.map(dbEventToEvent)]);
      setHasMore(res.headers.get("X-Has-More") === "1");
      setNextOffset(prev => prev + data.length);
    } catch {
      // Keep whatever is already shown; user can scroll up and back down to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [authToken, hasMore, loadingMore, loading, nextOffset]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Retry driver: while the fetch is auth-pending, re-run on a short cadence
  // until an authenticated fetch lands, then give up into a retryable error.
  useEffect(() => {
    const decision = nextRetryDecision(authRace);
    if (decision.action === "give-up") {
      setAuthRace(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void load(); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [authRace, load]);

  const retry = useCallback(() => {
    setAuthRace(resetAuthRaceState());
    setLoading(true);
    void load();
  }, [load]);

  // Single source of truth for what the list body renders. `authPending` keeps
  // us on the spinner (never the empty state) during the auth race; a genuine
  // authenticated zero-plan response is the only path to "empty".
  const renderMode = vaultRenderMode({
    loading,
    authPending: authRace.authPending,
    authError: authRace.authError,
    photoCount: allPlans.length,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  const isPastPlan = useCallback((e: Event): boolean => {
    if (e.type === "trip") return isTripPast(e);
    const d = parseEventDate(e.date);
    return !!d && d < new Date();
  }, []);

  const matchesSearch = useCallback((e: Event): boolean => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q);
  }, [search]);

  const { trips, events, past } = useMemo(() => {
    const filtered = allPlans.filter((e) => !e.cancelled && matchesSearch(e));
    const upcoming = filtered.filter((e) => !isPastPlan(e));
    // Happening-now trips float to the top of the Trips segment.
    const tripList = upcoming
      .filter((e) => e.type === "trip")
      .sort((a, b) => {
        const an = isHappeningNow(a) ? 1 : 0;
        const bn = isHappeningNow(b) ? 1 : 0;
        if (an !== bn) return bn - an;
        return (a.startAt ?? "").localeCompare(b.startAt ?? "");
      });
    return {
      trips: tripList,
      events: upcoming.filter((e) => e.type !== "trip"),
      past: filtered.filter((e) => isPastPlan(e)),
    };
  }, [allPlans, matchesSearch, isPastPlan]);

  const listData = segment === "trips" ? trips : segment === "events" ? events : past;

  const primaryCta = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (segment === "events") router.push("/create" as never);
    else router.push("/trip/start" as never);
  }, [segment]);

  const renderItem = useCallback(({ item }: { item: Event }) => {
    const card = item.type === "trip" ? (
      <TripCard trip={item} />
    ) : (
      <EventCard
        id={item.id}
        emoji={item.emoji}
        title={item.title}
        date={item.date}
        location={item.location}
        hostId={item.hostId}
        attendeeCount={goingCount(item)}
      />
    );
    // T210: past cards get a thumbnail strip when vault photos exist.
    if (isPastPlan(item)) {
      return (
        <View>
          {card}
          <PastPhotoStrip eventId={item.id} />
        </View>
      );
    }
    return card;
  }, [isPastPlan]);

  const emptyCopy: Record<Segment, { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; cta?: string }> = {
    trips: { icon: "airplane-outline", title: "No trips yet", sub: "Plan a multi-day getaway with your squad — build an itinerary together.", cta: "Start a Trip" },
    events: { icon: "calendar-outline", title: "No events yet", sub: "Plan something with your squad — or find a time everyone's free first.", cta: "Plan an Event" },
    past: { icon: "time-outline", title: "Nothing in the past", sub: "Your wrapped-up trips and events will live here." },
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Plans</Text>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowJoinModal(true);
            }}
            style={[styles.joinCodeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name="ticket-outline" size={16} color={colors.primary} />
            <Text style={[styles.joinCodeText, { color: colors.primary }]}>Join with code</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search plans..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.segmentRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {SEGMENTS.map((s) => {
            const active = segment === s.key;
            const count = s.key === "trips" ? trips.length : s.key === "events" ? events.length : past.length;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSegment(s.key); }}
                style={[styles.segment, active && { backgroundColor: colors.primary }]}
                activeOpacity={0.8}
              >
                <Ionicons name={s.icon} size={15} color={active ? "#fff" : colors.mutedForeground} />
                <Text style={[styles.segmentText, { color: active ? "#fff" : colors.mutedForeground }]}>
                  {s.label}{count > 0 ? ` ${count}` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + (Platform.OS === "web" ? 84 : 100),
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        removeClippedSubviews={Platform.OS !== "web"}
        onEndReached={() => { void loadMore(); }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadMoreFooter}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          renderMode === "loading" ? (
            <View style={styles.empty}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : renderMode === "error" ? (
            <View style={styles.empty}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load your plans</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Check your connection and try again.
              </Text>
              <TouchableOpacity
                onPress={retry}
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="refresh-outline" size={18} color="#fff" />
                <Text style={styles.emptyBtnText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name={emptyCopy[segment].icon} size={48} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{emptyCopy[segment].title}</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>{emptyCopy[segment].sub}</Text>
              {emptyCopy[segment].cta ? (
                <TouchableOpacity
                  onPress={primaryCta}
                  style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                >
                  <Ionicons name="add-circle-outline" size={18} color="#fff" />
                  <Text style={styles.emptyBtnText}>{emptyCopy[segment].cta}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )
        }
        renderItem={renderItem}
      />

      {segment !== "past" && (
        <TouchableOpacity
          onPress={primaryCta}
          activeOpacity={0.9}
          style={[
            styles.fab,
            {
              backgroundColor: colors.primary,
              bottom: insets.bottom + (Platform.OS === "web" ? 96 : 24),
            },
          ]}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      <JoinCodeModal visible={showJoinModal} onClose={() => setShowJoinModal(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pastStrip: { flexDirection: "row", gap: 6, marginTop: 8 },
  pastStripThumb: { flex: 1, height: 64, borderRadius: 10 },
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "900" },
  joinCodeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 7,
  },
  joinCodeText: { fontSize: 13, fontWeight: "700" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, height: 48,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15 },
  segmentRow: { flexDirection: "row", borderRadius: 14, borderWidth: 1, padding: 4, gap: 4 },
  segment: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    borderRadius: 10, paddingVertical: 9,
  },
  segmentText: { fontSize: 13, fontWeight: "800" },
  empty: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", paddingHorizontal: 24, lineHeight: 20 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  fab: {
    position: "absolute", right: 20,
    width: 56, height: 56, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 20 },
  sheetTitle: { fontSize: 22, fontWeight: "800", marginBottom: 6 },
  sheetSub: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  codeInputRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1.5,
    paddingHorizontal: 14, height: 52,
  },
  codeInput: { flex: 1, fontSize: 18, fontWeight: "700", letterSpacing: 2 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  errorText: { fontSize: 13, fontWeight: "600", flex: 1 },
  joinBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  joinBtnText: { fontSize: 16, fontWeight: "800", color: "#fff" },
  loadMoreFooter: { paddingVertical: 20, alignItems: "center" },
  successContent: { alignItems: "center", paddingVertical: 12 },
  successIcon: { width: 90, height: 90, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  successTitle: { fontSize: 28, fontWeight: "800", marginBottom: 6 },
  successSub: { fontSize: 15, textAlign: "center" },
});
