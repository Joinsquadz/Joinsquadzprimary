import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth, dbEventToEvent } from "@/context/AppContext";
import { useUserCache } from "@/context/UserCacheContext";
import { useEventStream } from "@/hooks/useEventStream";
import { UserAvatar } from "@/components/UserAvatar";
import { StopSheet } from "@/components/StopSheet";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import type { Event, ItineraryStop } from "@/types";
import {
  coverFor,
  formatTripRange,
  tripNights,
  tripDayKeys,
  todayKey,
  formatDayHeading,
  groupStopsByDay,
  sumStopCosts,
  isHappeningNow,
  STOP_CATEGORY_META,
} from "@/lib/tripUtils";
import {
  addStop,
  patchStop,
  deleteStop,
  voteStop,
  confirmStop,
  addPacking,
  patchPacking,
  deletePacking,
  type NewStopInput,
  type StopPatch,
} from "@/lib/tripApi";

type TripTab = "itinerary" | "budget" | "packing";

export default function TripDetailScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getEvent, refreshEvents, currentUser, getSquad } = useData();
  const { resolveUser } = useUserCache();
  const { authToken } = useAuth();

  // Past trips live in the Plans→Past segment but are NOT in the upcoming-only
  // AppContext.events list (refreshEvents fetches /api/events without
  // includePast). Fall back to fetching the single event directly so opening a
  // past trip from the Past hub resolves instead of showing "not available".
  const ctxEvent = getEvent(id ?? "");
  const [fallbackEvent, setFallbackEvent] = useState<Event | null>(null);
  const event = ctxEvent ?? fallbackEvent;

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/events/${id}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (!res.ok) return;
      const data = (await res.json()) as Record<string, unknown>;
      setFallbackEvent(dbEventToEvent(data));
    } catch {
      // Network unavailable — keep whatever we have.
    }
  }, [id, authToken]);

  // Refresh both the shared list (drives upcoming trips reactively) and the
  // single-event fallback (drives past trips not present in that list).
  const refresh = useCallback(async () => {
    await Promise.all([refreshEvents(), fetchDetail()]);
  }, [refreshEvents, fetchDetail]);

  // On mount / when the context misses (e.g. a past trip), hydrate the fallback.
  useEffect(() => {
    if (!ctxEvent && id && authToken) void fetchDetail();
  }, [ctxEvent, id, authToken, fetchDetail]);

  const [tab, setTab] = useState<TripTab>(
    tabParam === "budget" ? "budget" : tabParam === "packing" ? "packing" : "itinerary",
  );
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStop, setEditingStop] = useState<ItineraryStop | null>(null);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const [packingDraft, setPackingDraft] = useState("");

  const dayKeys = useMemo(() => (event ? tripDayKeys(event) : []), [event]);
  const today = todayKey();

  useEventStream({
    eventId: id ?? null,
    authToken,
    onUpdate: useCallback(() => {
      void refresh();
    }, [refresh]),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      void refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const runMut = useCallback(
    async (fn: () => Promise<{ conflict?: boolean; error?: string }>) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fn();
        if (res.conflict) {
          await refresh();
          Alert.alert("Just missed it", "Someone else updated this trip. We refreshed it for you — try again.");
        } else if (res.error) {
          Alert.alert("Something went wrong", res.error);
        } else {
          await refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  if (!event || event.type !== "trip") {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="airplane-outline" size={44} color={colors.textDim} />
        <Text style={[styles.missingText, { color: colors.mutedForeground }]}>This trip isn't available.</Text>
        <TouchableOpacity onPress={() => router.replace("/(tabs)/events" as never)} style={[styles.missingBtn, { borderColor: colors.border }]}>
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>Back to Plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const squad = getSquad(event.squadId);
  const isHost = event.hostId === currentUser.id;
  const stops = event.itinerary ?? [];
  const packing = event.packing ?? [];
  const cover = coverFor(event.coverStyle);
  const nights = tripNights(event);
  const happening = isHappeningNow(event);
  const grouped = groupStopsByDay(stops);
  const costs = sumStopCosts(stops);

  const openAddStop = (day?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingStop(null);
    setSheetDay(day ?? (dayKeys.includes(today) ? today : dayKeys[0] ?? today));
    setSheetOpen(true);
  };

  const openEditStop = (stop: ItineraryStop) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingStop(stop);
    setSheetDay(stop.day);
    setSheetOpen(true);
  };

  const submitStop = (data: NewStopInput | StopPatch, isEdit: boolean) => {
    setSheetOpen(false);
    void runMut(async () => {
      if (isEdit && editingStop) {
        return patchStop(event.id, editingStop.id, authToken, data as StopPatch, event.version);
      }
      return addStop(event.id, authToken, data as NewStopInput, event.version);
    });
  };

  const confirmDelete = (stop: ItineraryStop) => {
    Alert.alert("Remove stop", `Remove "${stop.title}" from the itinerary?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => void runMut(() => deleteStop(event.id, stop.id, authToken, event.version)),
      },
    ]);
  };

  const addPackingItem = () => {
    const label = packingDraft.trim();
    if (!label) return;
    setPackingDraft("");
    void runMut(() => addPacking(event.id, authToken, label, event.version));
  };

  const renderStop = (stop: ItineraryStop) => {
    const meta = STOP_CATEGORY_META[stop.category];
    const tint = colors[meta.colorKey];
    const proposed = stop.status === "proposed";
    const voted = stop.votes.includes(currentUser.id);
    const mine = stop.createdBy === currentUser.id;
    return (
      <View key={stop.id} style={[styles.stopRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <View style={styles.stopRail}>
          <View style={[styles.stopDot, { backgroundColor: tint }]}>
            <Ionicons name={meta.icon as keyof typeof Ionicons.glyphMap} size={13} color="#fff" />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.stopHead}>
            {stop.time ? <Text style={[styles.stopTime, { color: colors.mutedForeground }]}>{stop.time}</Text> : null}
            {proposed ? (
              <View style={[styles.proposedPill, { backgroundColor: colors.gold + "22" }]}>
                <Text style={[styles.proposedPillText, { color: colors.gold }]}>Proposed</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.stopTitle, { color: colors.foreground }]}>{stop.title}</Text>
          {stop.placeName ? <Text style={[styles.stopPlace, { color: colors.mutedForeground }]}>{stop.placeName}</Text> : null}
          {stop.address ? <Text style={[styles.stopAddress, { color: colors.textDim }]}>{stop.address}</Text> : null}
          {stop.note ? <Text style={[styles.stopNote, { color: colors.mutedForeground }]}>{stop.note}</Text> : null}
          <View style={styles.stopFooter}>
            {typeof stop.cost === "number" && stop.cost > 0 ? (
              <Text style={[styles.stopCost, { color: colors.green }]}>${stop.cost.toFixed(0)}/person</Text>
            ) : null}
            {proposed ? (
              <TouchableOpacity
                onPress={() => void runMut(() => voteStop(event.id, stop.id, authToken, event.version))}
                style={[styles.voteBtn, { borderColor: voted ? colors.primary : colors.border, backgroundColor: voted ? colors.primary + "18" : "transparent" }]}
              >
                <Ionicons name={voted ? "heart" : "heart-outline"} size={14} color={voted ? colors.primary : colors.mutedForeground} />
                <Text style={[styles.voteText, { color: voted ? colors.primary : colors.mutedForeground }]}>
                  {stop.votes.length > 0 ? stop.votes.length : "Vote"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {proposed && (isHost || mine) ? (
              <TouchableOpacity
                onPress={() => void runMut(() => confirmStop(event.id, stop.id, authToken, event.version))}
                style={[styles.confirmBtn, { backgroundColor: colors.green + "1F" }]}
              >
                <Ionicons name="checkmark-circle" size={14} color={colors.green} />
                <Text style={[styles.confirmText, { color: colors.green }]}>Confirm</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        {isHost || mine ? (
          <View style={styles.stopActions}>
            <TouchableOpacity onPress={() => openEditStop(stop)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="create-outline" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => confirmDelete(stop)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        stickyHeaderIndices={[1]}
      >
        {/* Cover header */}
        <LinearGradient colors={cover} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.cover, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12) }]}>
          <View style={styles.coverTopRow}>
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/events" as never))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.coverIconBtn}
            >
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            {happening ? (
              <View style={styles.nowBadge}>
                <View style={styles.nowDot} />
                <Text style={styles.nowText}>Happening now</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.coverTitle}>{event.title}</Text>
          <View style={styles.coverMetaRow}>
            <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.92)" />
            <Text style={styles.coverMeta}>{formatTripRange(event)}</Text>
            <Text style={styles.coverDot}>·</Text>
            <Text style={styles.coverMeta}>{nights} {nights === 1 ? "night" : "nights"}</Text>
          </View>
          {squad ? (
            <View style={styles.coverMetaRow}>
              <Ionicons name="people-outline" size={14} color="rgba(255,255,255,0.92)" />
              <Text style={styles.coverMeta}>{squad.name}</Text>
            </View>
          ) : null}
        </LinearGradient>

        {/* Sticky tab bar */}
        <View style={[styles.tabBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
          {(["itinerary", "budget", "packing"] as const).map((t) => {
            const active = tab === t;
            const labels = { itinerary: "Itinerary", budget: "Budget", packing: "Packing" };
            return (
              <TouchableOpacity key={t} onPress={() => setTab(t)} style={styles.tabBtn}>
                <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>{labels[t]}</Text>
                {active ? <View style={[styles.tabUnderline, { backgroundColor: colors.primary }]} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ITINERARY */}
        {tab === "itinerary" ? (
          <View style={styles.tabBody}>
            {happening && grouped[today]?.length ? (
              <View style={[styles.todayCard, { borderColor: colors.primary + "55", backgroundColor: colors.primary + "10" }]}>
                <Text style={[styles.todayLabel, { color: colors.primary }]}>TODAY</Text>
                {grouped[today].map((s) => (
                  <Text key={s.id} style={[styles.todayStop, { color: colors.foreground }]} numberOfLines={1}>
                    {s.time ? `${s.time} · ` : ""}{s.title}
                  </Text>
                ))}
              </View>
            ) : null}

            {stops.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="map-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No stops yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Build the plan day by day. Add your first stop to get the squad excited.
                </Text>
              </View>
            ) : (
              dayKeys.map((key, i) => {
                const dayStops = grouped[key] ?? [];
                const heading = formatDayHeading(key, i);
                const isToday = key === today;
                return (
                  <View key={key} style={styles.daySection}>
                    <View style={styles.dayHeader}>
                      <View>
                        <Text style={[styles.dayLabel, { color: isToday ? colors.primary : colors.foreground }]}>
                          {heading.label}{isToday ? " · Today" : ""}
                        </Text>
                        <Text style={[styles.daySub, { color: colors.mutedForeground }]}>{heading.sub}</Text>
                      </View>
                      <TouchableOpacity onPress={() => openAddStop(key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.dayAddBtn}>
                        <Ionicons name="add" size={18} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                    {dayStops.length === 0 ? (
                      <TouchableOpacity onPress={() => openAddStop(key)} style={[styles.dayEmpty, { borderColor: colors.border }]}>
                        <Text style={[styles.dayEmptyText, { color: colors.textDim }]}>Nothing planned — tap to add</Text>
                      </TouchableOpacity>
                    ) : (
                      dayStops.map(renderStop)
                    )}
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {/* BUDGET */}
        {tab === "budget" ? (
          <View style={styles.tabBody}>
            <View style={[styles.budgetCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.budgetLabel, { color: colors.mutedForeground }]}>Estimated per person</Text>
              <Text style={[styles.budgetTotal, { color: colors.foreground }]}>${costs.confirmed.toFixed(0)}</Text>
              {costs.proposed > 0 ? (
                <Text style={[styles.budgetProposed, { color: colors.gold }]}>
                  +${costs.proposed.toFixed(0)} if proposed stops get confirmed
                </Text>
              ) : null}
            </View>

            <Text style={[styles.budgetBreakHead, { color: colors.mutedForeground }]}>BY STOP</Text>
            {stops.filter((s) => typeof s.cost === "number" && s.cost > 0).length === 0 ? (
              <Text style={[styles.emptySub, { color: colors.textDim, paddingHorizontal: 4 }]}>
                Add estimated costs to stops and they'll roll up here.
              </Text>
            ) : (
              stops
                .filter((s) => typeof s.cost === "number" && s.cost > 0)
                .map((s) => (
                  <View key={s.id} style={[styles.budgetRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.budgetRowTitle, { color: colors.foreground }]} numberOfLines={1}>{s.title}</Text>
                    {s.status === "proposed" ? (
                      <Text style={[styles.budgetRowTag, { color: colors.gold }]}>proposed</Text>
                    ) : null}
                    <Text style={[styles.budgetRowCost, { color: colors.foreground }]}>${(s.cost ?? 0).toFixed(0)}</Text>
                  </View>
                ))
            )}

            <TouchableOpacity
              onPress={() => router.push(`/event/${event.id}?tab=costs` as never)}
              style={[styles.costSplitBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Ionicons name="cash-outline" size={18} color={colors.green} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.costSplitTitle, { color: colors.foreground }]}>Split actual costs</Text>
                <Text style={[styles.costSplitSub, { color: colors.mutedForeground }]}>Track who paid & settle up</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* PACKING */}
        {tab === "packing" ? (
          <View style={styles.tabBody}>
            <View style={[styles.packAdd, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <TextInput
                value={packingDraft}
                onChangeText={setPackingDraft}
                placeholder="Add a packing item…"
                placeholderTextColor={colors.textDim}
                style={[styles.packInput, { color: colors.foreground }]}
                onSubmitEditing={addPackingItem}
                returnKeyType="done"
              />
              <TouchableOpacity onPress={addPackingItem} disabled={!packingDraft.trim()} style={[styles.packAddBtn, { backgroundColor: colors.primary, opacity: packingDraft.trim() ? 1 : 0.4 }]}>
                <Ionicons name="add" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {packing.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="bag-handle-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing to pack… yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Build a shared checklist so nobody forgets the essentials.</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.packCount, { color: colors.mutedForeground }]}>
                  {packing.filter((p) => p.done).length} of {packing.length} packed
                </Text>
                {packing.map((item) => (
                  <View key={item.id} style={[styles.packRow, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity
                      onPress={() => void runMut(() => patchPacking(event.id, item.id, authToken, { done: !item.done }, event.version))}
                      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                      style={styles.packToggle}
                    >
                      <View
                        style={[styles.packCheck, { borderColor: item.done ? colors.green : colors.border, backgroundColor: item.done ? colors.green : "transparent" }]}
                      >
                        {item.done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                      </View>
                      <Text style={[styles.packLabel, { color: item.done ? colors.mutedForeground : colors.foreground, textDecorationLine: item.done ? "line-through" : "none" }]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                    {item.assigneeId ? (() => {
                      const u = resolveUser(item.assigneeId);
                      return <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={22} fontSize={9} />;
                    })() : null}
                    {item.createdBy === currentUser.id || isHost ? (
                      <TouchableOpacity
                        onPress={() => void runMut(() => deletePacking(event.id, item.id, authToken, event.version))}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close" size={16} color={colors.textDim} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* FAB for itinerary */}
      {tab === "itinerary" ? (
        <TouchableOpacity
          onPress={() => openAddStop()}
          activeOpacity={0.9}
          style={[styles.fab, { bottom: insets.bottom + 24 }]}
        >
          <LinearGradient colors={["#FF5C3A", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
            <Ionicons name="add" size={26} color="#fff" />
            <Text style={styles.fabText}>Add stop</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}

      <StopSheet
        visible={sheetOpen}
        dayKeys={dayKeys}
        defaultDay={sheetDay ?? dayKeys[0] ?? today}
        editing={editingStop}
        saving={busy}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitStop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  missingText: { fontSize: 15, fontWeight: "600" },
  missingBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },

  cover: { paddingHorizontal: 20, paddingBottom: 22 },
  coverTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  coverIconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.22)", alignItems: "center", justifyContent: "center" },
  nowBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2ECC8A" },
  nowText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  coverTitle: { color: "#fff", fontSize: 30, fontWeight: "900", marginBottom: 8 },
  coverMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  coverMeta: { color: "rgba(255,255,255,0.95)", fontSize: 14, fontWeight: "700" },
  coverDot: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" },

  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 14 },
  tabText: { fontSize: 14, fontWeight: "800" },
  tabUnderline: { position: "absolute", bottom: 0, height: 2.5, width: "55%", borderRadius: 2 },

  tabBody: { paddingHorizontal: 20, paddingTop: 18 },

  todayCard: { borderRadius: 16, borderWidth: 1.5, padding: 14, marginBottom: 20 },
  todayLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1, marginBottom: 8 },
  todayStop: { fontSize: 14, fontWeight: "700", marginTop: 3 },

  daySection: { marginBottom: 22 },
  dayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  dayLabel: { fontSize: 17, fontWeight: "900" },
  daySub: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  dayAddBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  dayEmpty: { borderRadius: 12, borderWidth: 1, borderStyle: "dashed", paddingVertical: 16, alignItems: "center" },
  dayEmptyText: { fontSize: 13, fontWeight: "600" },

  stopRow: { flexDirection: "row", gap: 10, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 10 },
  stopRail: { alignItems: "center", paddingTop: 2 },
  stopDot: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stopHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  stopTime: { fontSize: 12, fontWeight: "800" },
  proposedPill: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  proposedPillText: { fontSize: 10, fontWeight: "800" },
  stopTitle: { fontSize: 16, fontWeight: "800" },
  stopPlace: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  stopAddress: { fontSize: 12, marginTop: 1 },
  stopNote: { fontSize: 13, marginTop: 5, lineHeight: 18 },
  stopFooter: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" },
  stopCost: { fontSize: 13, fontWeight: "800" },
  voteBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 11, paddingVertical: 5 },
  voteText: { fontSize: 12, fontWeight: "800" },
  confirmBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  confirmText: { fontSize: 12, fontWeight: "800" },
  stopActions: { gap: 14, paddingLeft: 2, alignItems: "center" },

  budgetCard: { borderRadius: 18, borderWidth: 1, padding: 20, alignItems: "center", marginBottom: 24 },
  budgetLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  budgetTotal: { fontSize: 40, fontWeight: "900", marginTop: 6 },
  budgetProposed: { fontSize: 13, fontWeight: "700", marginTop: 6, textAlign: "center" },
  budgetBreakHead: { fontSize: 12, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  budgetRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 13, borderBottomWidth: 1 },
  budgetRowTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  budgetRowTag: { fontSize: 11, fontWeight: "700" },
  budgetRowCost: { fontSize: 15, fontWeight: "800" },
  costSplitBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 24 },
  costSplitTitle: { fontSize: 15, fontWeight: "800" },
  costSplitSub: { fontSize: 12, fontWeight: "600", marginTop: 1 },

  packAdd: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingLeft: 14, paddingRight: 6, height: 52, marginBottom: 18 },
  packInput: { flex: 1, fontSize: 15 },
  packAddBtn: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  packCount: { fontSize: 12, fontWeight: "700", marginBottom: 8 },
  packRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1 },
  packToggle: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 },
  packCheck: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  packLabel: { flex: 1, fontSize: 15, fontWeight: "600" },

  empty: { alignItems: "center", gap: 8, paddingVertical: 40, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 17, fontWeight: "800" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  fab: { position: "absolute", right: 20, borderRadius: 26, overflow: "hidden", shadowColor: "#FF5C3A", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  fabInner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, paddingVertical: 14 },
  fabText: { color: "#fff", fontSize: 15, fontWeight: "800" },
});
