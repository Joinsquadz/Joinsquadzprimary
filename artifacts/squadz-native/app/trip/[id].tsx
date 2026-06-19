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
  Modal,
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
import FriendPickerSheet from "@/components/FriendPickerSheet";
import { ChatMessages, ChatComposer } from "@/components/EventChatPanel";
import { EventCostsPanel } from "@/components/EventCostsPanel";
import { EventVaultPanel } from "@/components/EventVaultPanel";
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
  TRIP_COVER_KEYS,
  TRIP_COVERS,
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

type TripTab = "itinerary" | "chat" | "costs" | "vault" | "budget" | "packing";

const TRIP_TABS: TripTab[] = ["itinerary", "chat", "costs", "vault", "budget", "packing"];
const TRIP_TAB_LABELS: Record<TripTab, string> = {
  itinerary: "Itinerary",
  chat: "Chat",
  costs: "Costs",
  vault: "Vault",
  budget: "Budget",
  packing: "Packing",
};

export default function TripDetailScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    getEvent,
    refreshEvents,
    currentUser,
    getSquad,
    squads,
    inviteToEvent,
    uninviteFromEvent,
    updateEvent,
    cancelEvent,
    addEventCoAdmin,
    removeEventCoAdmin,
  } = useData();
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
    TRIP_TABS.includes(tabParam as TripTab) ? (tabParam as TripTab) : "itinerary",
  );
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStop, setEditingStop] = useState<ItineraryStop | null>(null);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  const [packingDraft, setPackingDraft] = useState("");
  const [liveView, setLiveView] = useState(false);
  const [arrivedIdx, setArrivedIdx] = useState(0);
  const [showInvitePicker, setShowInvitePicker] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [edit, setEdit] = useState({ title: "", location: "", description: "", emoji: "" });
  const [coverDraft, setCoverDraft] = useState("");

  const dayKeys = useMemo(() => (event ? tripDayKeys(event) : []), [event]);
  const today = todayKey();

  // Roster for the assignee picker: squad members PLUS directly-invited friends
  // (deduped). Empty for personal trips with no invites.
  const memberOptions = useMemo(() => {
    const sq = event ? getSquad(event.squadId) : undefined;
    const ids = new Set<string>([...(sq?.memberIds ?? []), ...(event?.invitedUserIds ?? [])]);
    return [...ids].map((mid) => ({ id: mid, name: resolveUser(mid).name }));
  }, [event, getSquad, resolveUser]);

  // Invited friends not already in the squad — shown in the "Who's invited" row.
  const invitedExtras = useMemo(() => {
    const sq = event ? getSquad(event.squadId) : undefined;
    const memberSet = new Set(sq?.memberIds ?? []);
    return (event?.invitedUserIds ?? [])
      .filter((uid) => !memberSet.has(uid))
      .map((uid) => resolveUser(uid));
  }, [event, getSquad, resolveUser]);

  // Everyone who can be included in a cost split: squad members + invited
  // friends (deduped), each fully resolved. Always includes the current user so
  // a solo/personal trip can still split (just with themselves listed).
  const costParticipants = useMemo(() => {
    const sq = event ? getSquad(event.squadId) : undefined;
    const ids = new Set<string>([
      ...(sq?.memberIds ?? []),
      ...(event?.invitedUserIds ?? []),
      currentUser.id,
    ]);
    return [...ids].map((uid) => resolveUser(uid));
  }, [event, getSquad, resolveUser, currentUser.id]);

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
  const coAdminIds = event.coAdminIds ?? [];
  // "Help manage" rights: host plus co-admins can edit details/color/itinerary.
  const canManage = isHost || coAdminIds.includes(currentUser.id);
  // Anyone with trip access can invite (matches the backend, which gates invites
  // on getEventAsMember): host, a current squad member, or an invited friend.
  const canInvite =
    isHost ||
    (squad?.memberIds.includes(currentUser.id) ?? false) ||
    (event.invitedUserIds ?? []).includes(currentUser.id);

  // Members who can be promoted to co-admin: squad members + invited friends,
  // minus the host and anyone already a co-admin. Resolved for display.
  const coAdminCandidates = [...new Set([...(squad?.memberIds ?? []), ...(event.invitedUserIds ?? [])])]
    .filter((uid) => uid !== event.hostId && !coAdminIds.includes(uid))
    .map((uid) => resolveUser(uid));
  const coAdmins = coAdminIds.map((uid) => resolveUser(uid));
  // Squads the current user can re-associate this trip with (those they're in).
  const mySquads = squads;

  const openAdmin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEdit({
      title: event.title,
      location: event.location,
      description: event.description,
      emoji: event.emoji,
    });
    setCoverDraft(event.coverStyle || "sunset");
    setAdminOpen(true);
  };

  const saveDetails = () => {
    if (!edit.title.trim()) {
      Alert.alert("Missing info", "A trip needs a title.");
      return;
    }
    updateEvent(event.id, {
      title: edit.title.trim(),
      location: edit.location.trim(),
      description: edit.description.trim(),
      emoji: edit.emoji.trim() || event.emoji,
      coverStyle: coverDraft,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdminOpen(false);
  };

  const reassignSquad = (squadId: string) => {
    if (squadId === event.squadId) return;
    Haptics.selectionAsync();
    updateEvent(event.id, { squadId });
  };

  const confirmCancelTrip = () => {
    Alert.alert("Cancel trip", `Cancel "${event.title}"? This can't be undone.`, [
      { text: "Keep trip", style: "cancel" },
      {
        text: "Cancel trip",
        style: "destructive",
        onPress: () => {
          cancelEvent(event.id);
          setAdminOpen(false);
          if (router.canGoBack()) router.back();
          else router.replace("/(tabs)/events" as never);
        },
      },
    ]);
  };
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
            {stop.time ? (
              <Text style={[styles.stopTime, { color: colors.mutedForeground }]}>
                {stop.endTime ? `${stop.time} – ${stop.endTime}` : stop.time}
              </Text>
            ) : null}
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
          {stop.assigneeId ? (() => {
            const u = resolveUser(stop.assigneeId);
            return (
              <View style={styles.stopAssignee}>
                <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={18} fontSize={8} />
                <Text style={[styles.stopAssigneeText, { color: colors.mutedForeground }]}>{u.name}</Text>
              </View>
            );
          })() : null}
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
            {proposed ? (
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

  // ── Today / live view ──────────────────────────────────────────────────────
  // Reached from the cover "Today" shortcut: an "Up next" hero (advanced with
  // "We're here"), the rest of today, and a running per-person spend.
  if (liveView) {
    const todayStops = grouped[today] ?? [];
    const upNext = arrivedIdx < todayStops.length ? todayStops[arrivedIdx] : null;
    const restToday = todayStops.slice(arrivedIdx + 1);
    const runningSpend = todayStops
      .slice(0, arrivedIdx + 1)
      .filter((s) => s.status === "confirmed" && typeof s.cost === "number")
      .reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const timeLabel = (s: ItineraryStop) => (s.time ? (s.endTime ? `${s.time} – ${s.endTime}` : s.time) : "");
    return (
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <LinearGradient colors={cover} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.liveHeader, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12) }]}>
          <View style={styles.coverTopRow}>
            <TouchableOpacity onPress={() => setLiveView(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.coverIconBtn}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.nowBadge}>
              <View style={styles.nowDot} />
              <Text style={styles.nowText}>Live · Today</Text>
            </View>
          </View>
          <Text style={styles.liveTitle}>{event.title}</Text>
          <Text style={styles.liveSpend}>${runningSpend.toFixed(0)}/person spent so far today</Text>
        </LinearGradient>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
          {todayStops.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="sunny-outline" size={40} color={colors.textDim} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing planned today</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add a stop for today to see it light up here.</Text>
            </View>
          ) : upNext ? (
            <>
              <Text style={[styles.liveSectionLabel, { color: colors.primary }]}>UP NEXT</Text>
              <View style={[styles.liveHero, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
                {timeLabel(upNext) ? <Text style={[styles.liveHeroTime, { color: colors.mutedForeground }]}>{timeLabel(upNext)}</Text> : null}
                <Text style={[styles.liveHeroTitle, { color: colors.foreground }]}>{upNext.title}</Text>
                {upNext.placeName ? <Text style={[styles.liveHeroPlace, { color: colors.mutedForeground }]}>{upNext.placeName}</Text> : null}
                {typeof upNext.cost === "number" && upNext.cost > 0 ? (
                  <Text style={[styles.liveHeroCost, { color: colors.green }]}>${upNext.cost.toFixed(0)}/person</Text>
                ) : null}
                <TouchableOpacity
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setArrivedIdx((i) => i + 1); }}
                  style={styles.liveHereBtn}
                >
                  <LinearGradient colors={["#FF5C3A", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.liveHereInner}>
                    <Ionicons name="checkmark-done" size={18} color="#fff" />
                    <Text style={styles.liveHereText}>We're here</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>

              {restToday.length > 0 ? (
                <>
                  <Text style={[styles.liveSectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>REST OF TODAY</Text>
                  {restToday.map((s) => (
                    <View key={s.id} style={[styles.liveRestRow, { borderBottomColor: colors.border }]}>
                      {timeLabel(s) ? <Text style={[styles.liveRestTime, { color: colors.mutedForeground }]}>{timeLabel(s)}</Text> : null}
                      <Text style={[styles.liveRestTitle, { color: colors.foreground }]} numberOfLines={1}>{s.title}</Text>
                      {typeof s.cost === "number" && s.cost > 0 ? (
                        <Text style={[styles.liveRestCost, { color: colors.green }]}>${s.cost.toFixed(0)}</Text>
                      ) : null}
                    </View>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={44} color={colors.green} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>That's a wrap for today</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>You've made it through every stop. ${runningSpend.toFixed(0)}/person spent today.</Text>
              <TouchableOpacity onPress={() => setArrivedIdx(0)} style={[styles.missingBtn, { borderColor: colors.border, marginTop: 8 }]}>
                <Text style={{ color: colors.foreground, fontWeight: "700" }}>Replay today</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    );
  }

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
            <View style={styles.coverTopRight}>
              {happening ? (
                <View style={styles.nowBadge}>
                  <View style={styles.nowDot} />
                  <Text style={styles.nowText}>Happening now</Text>
                </View>
              ) : null}
              {dayKeys.includes(today) ? (
                <TouchableOpacity
                  onPress={() => { setArrivedIdx(0); setLiveView(true); }}
                  style={styles.todayBtn}
                >
                  <Ionicons name="navigate" size={13} color="#fff" />
                  <Text style={styles.todayBtnText}>Today</Text>
                </TouchableOpacity>
              ) : null}
              {canManage ? (
                <TouchableOpacity onPress={openAdmin} style={styles.coverIconBtn} hitSlop={8}>
                  <Ionicons name="settings-outline" size={20} color="#fff" />
                </TouchableOpacity>
              ) : null}
            </View>
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

        {/* Who's invited */}
        <View style={styles.invitePanel}>
          <View style={styles.inviteHeaderRow}>
            <Text style={[styles.inviteHeading, { color: colors.foreground }]}>Who's invited</Text>
            {canInvite ? (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowInvitePicker(true); }}
                style={styles.inviteAddBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="person-add-outline" size={16} color={colors.primary} />
                <Text style={[styles.inviteAddText, { color: colors.primary }]}>Invite friends</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {invitedExtras.length === 0 ? (
            <Text style={[styles.inviteEmpty, { color: colors.mutedForeground }]}>
              {squad ? "Everyone in the squad, plus anyone you invite." : "Invite friends to join this trip."}
            </Text>
          ) : (
            <View style={styles.inviteChipWrap}>
              {invitedExtras.map((u) => (
                <View key={u.id} style={[styles.inviteChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={22} />
                  <Text style={[styles.inviteChipName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                  {isHost || u.id === currentUser.id ? (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync();
                        void uninviteFromEvent(event.id, u.id).then((r) => {
                          if (r.error) Alert.alert("Couldn't remove", r.error);
                          else void refresh();
                        });
                      }}
                      hitSlop={6}
                    >
                      <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Sticky tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabBar, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
          contentContainerStyle={styles.tabBarContent}
        >
          {TRIP_TABS.map((t) => {
            const active = tab === t;
            return (
              <TouchableOpacity key={t} onPress={() => { Haptics.selectionAsync(); setTab(t); }} style={styles.tabBtn}>
                <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>{TRIP_TAB_LABELS[t]}</Text>
                {active ? <View style={[styles.tabUnderline, { backgroundColor: colors.primary }]} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* CHAT */}
        {tab === "chat" ? (
          <View style={styles.tabBody}>
            <ChatMessages event={event} />
          </View>
        ) : null}

        {/* COSTS */}
        {tab === "costs" ? (
          <View style={styles.tabBody}>
            <EventCostsPanel event={event} isHost={isHost} botPad={insets.bottom} participants={costParticipants} />
          </View>
        ) : null}

        {/* VAULT */}
        {tab === "vault" ? (
          <View style={styles.tabBody}>
            <EventVaultPanel event={event} />
          </View>
        ) : null}

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
              onPress={() => { Haptics.selectionAsync(); setTab("costs"); }}
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

      {/* Sticky chat composer — sibling of the ScrollView so it pins to the bottom */}
      {tab === "chat" ? <ChatComposer event={event} botPad={insets.bottom} /> : null}

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
        members={memberOptions}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitStop}
      />

      <FriendPickerSheet
        visible={showInvitePicker}
        title="Invite to trip"
        confirmLabel="Invite"
        excludeIds={[event.hostId, ...(squad?.memberIds ?? []), ...(event.invitedUserIds ?? [])]}
        onClose={() => setShowInvitePicker(false)}
        onConfirm={async (ids) => {
          const res = await inviteToEvent(event.id, ids);
          setShowInvitePicker(false);
          if (res.error) Alert.alert("Couldn't invite", res.error);
          else void refresh();
        }}
      />

      {/* ---- Admin sheet ---- */}
      <Modal visible={adminOpen} transparent animationType="slide" onRequestClose={() => setAdminOpen(false)}>
        <View style={styles.adminBackdrop}>
          <View style={[styles.adminSheet, { backgroundColor: colors.background, maxHeight: "88%" }]}>
            <View style={styles.adminHeader}>
              <Text style={[styles.adminTitle, { color: colors.foreground }]}>Manage trip</Text>
              <TouchableOpacity onPress={() => setAdminOpen(false)} hitSlop={10} style={styles.adminCloseBtn}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            >
              {/* Details */}
              <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Details</Text>
              <View style={styles.adminFieldRow}>
                <TextInput
                  value={edit.emoji}
                  onChangeText={(t) => setEdit((e) => ({ ...e, emoji: t }))}
                  placeholder="🏝️"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={2}
                  style={[styles.adminEmoji, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                />
                <TextInput
                  value={edit.title}
                  onChangeText={(t) => setEdit((e) => ({ ...e, title: t }))}
                  placeholder="Trip title"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.adminInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
                />
              </View>
              <TextInput
                value={edit.location}
                onChangeText={(t) => setEdit((e) => ({ ...e, location: t }))}
                placeholder="Location"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.adminInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />
              <TextInput
                value={edit.description}
                onChangeText={(t) => setEdit((e) => ({ ...e, description: t }))}
                placeholder="What's the plan?"
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[styles.adminInput, styles.adminTextarea, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />

              {/* Color */}
              <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Cover color</Text>
              <View style={styles.coverSwatchRow}>
                {TRIP_COVER_KEYS.map((key) => {
                  const c = TRIP_COVERS[key];
                  const active = coverDraft === key;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => { Haptics.selectionAsync(); setCoverDraft(key); }}
                      activeOpacity={0.85}
                      style={[styles.coverSwatchWrap, active && { borderColor: colors.primary }]}
                    >
                      <LinearGradient colors={c} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.coverSwatch}>
                        {active ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                      </LinearGradient>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity onPress={saveDetails} activeOpacity={0.85} style={[styles.adminSaveBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.adminSaveText}>Save changes</Text>
              </TouchableOpacity>

              {/* Co-admins (host only) */}
              {isHost ? (
                <>
                  <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Co-admins</Text>
                  <Text style={[styles.adminHint, { color: colors.mutedForeground }]}>
                    Co-admins can edit details, the cover, and the itinerary. Only you can cancel the trip or change co-admins.
                  </Text>
                  {coAdmins.length === 0 ? null : (
                    <View style={{ gap: 8, marginBottom: 8 }}>
                      {coAdmins.map((u) => (
                        <View key={u.id} style={[styles.adminPersonRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                          <Text style={[styles.adminPersonName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                          <TouchableOpacity
                            onPress={() => {
                              Haptics.selectionAsync();
                              void removeEventCoAdmin(event.id, u.id).then((r) => {
                                if (r.error) Alert.alert("Couldn't update", r.error);
                                else void refresh();
                              });
                            }}
                            hitSlop={8}
                          >
                            <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  )}
                  {coAdminCandidates.length === 0 ? (
                    <Text style={[styles.adminHint, { color: colors.mutedForeground }]}>
                      Invite people to the trip first — then you can make them co-admins.
                    </Text>
                  ) : (
                    coAdminCandidates.map((u) => (
                      <TouchableOpacity
                        key={u.id}
                        onPress={() => {
                          Haptics.selectionAsync();
                          void addEventCoAdmin(event.id, u.id).then((r) => {
                            if (r.error) Alert.alert("Couldn't update", r.error);
                            else void refresh();
                          });
                        }}
                        activeOpacity={0.8}
                        style={[styles.adminPersonRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                      >
                        <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                        <Text style={[styles.adminPersonName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                      </TouchableOpacity>
                    ))
                  )}
                </>
              ) : null}

              {/* Associate squad (host only) */}
              {isHost ? (
                <>
                  <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Squad</Text>
                  <TouchableOpacity
                    onPress={() => reassignSquad("")}
                    activeOpacity={0.8}
                    style={[styles.adminPersonRow, { backgroundColor: colors.card, borderColor: !event.squadId ? colors.primary : colors.border }]}
                  >
                    <Ionicons name="person-outline" size={20} color={colors.foreground} />
                    <Text style={[styles.adminPersonName, { color: colors.foreground }]}>Personal (no squad)</Text>
                    {!event.squadId ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                  </TouchableOpacity>
                  {mySquads.map((sq) => {
                    const active = event.squadId === sq.id;
                    return (
                      <TouchableOpacity
                        key={sq.id}
                        onPress={() => reassignSquad(sq.id)}
                        activeOpacity={0.8}
                        style={[styles.adminPersonRow, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border }]}
                      >
                        <Ionicons name="people-outline" size={20} color={colors.foreground} />
                        <Text style={[styles.adminPersonName, { color: colors.foreground }]} numberOfLines={1}>{sq.name}</Text>
                        {active ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : null}

              {/* Cancel (host only) */}
              {isHost ? (
                <TouchableOpacity onPress={confirmCancelTrip} activeOpacity={0.85} style={[styles.adminCancelBtn, { borderColor: colors.destructive }]}>
                  <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                  <Text style={[styles.adminCancelText, { color: colors.destructive }]}>Cancel trip</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  missingText: { fontSize: 15, fontWeight: "600" },
  missingBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },

  invitePanel: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4, gap: 8 },
  inviteHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inviteHeading: { fontSize: 15, fontWeight: "700" },
  inviteAddBtn: { flexDirection: "row", alignItems: "center", gap: 5 },
  inviteAddText: { fontSize: 13, fontWeight: "700" },
  inviteEmpty: { fontSize: 13, lineHeight: 18 },
  inviteChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  inviteChip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 20, paddingVertical: 4, paddingLeft: 4, paddingRight: 9, maxWidth: "100%" },
  inviteChipName: { fontSize: 13, fontWeight: "600", maxWidth: 120 },

  cover: { paddingHorizontal: 20, paddingBottom: 22 },
  coverTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  coverIconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(0,0,0,0.22)", alignItems: "center", justifyContent: "center" },
  coverTopRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  todayBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6 },
  todayBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  nowBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.28)", borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#2ECC8A" },
  nowText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  coverTitle: { color: "#fff", fontSize: 30, fontWeight: "900", marginBottom: 8 },
  coverMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  coverMeta: { color: "rgba(255,255,255,0.95)", fontSize: 14, fontWeight: "700" },
  coverDot: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" },

  tabBar: { borderBottomWidth: 1, flexGrow: 0 },
  tabBarContent: { paddingHorizontal: 8 },
  tabBtn: { alignItems: "center", paddingVertical: 14, paddingHorizontal: 16 },
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
  stopAssignee: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  stopAssigneeText: { fontSize: 12, fontWeight: "700" },
  stopFooter: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" },

  liveHeader: { paddingHorizontal: 20, paddingBottom: 22 },
  liveTitle: { color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 6 },
  liveSpend: { color: "rgba(255,255,255,0.95)", fontSize: 14, fontWeight: "700", marginTop: 6 },
  liveSectionLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1, marginBottom: 10 },
  liveHero: { borderRadius: 20, borderWidth: 1.5, padding: 18 },
  liveHeroTime: { fontSize: 13, fontWeight: "800", marginBottom: 4 },
  liveHeroTitle: { fontSize: 22, fontWeight: "900" },
  liveHeroPlace: { fontSize: 14, fontWeight: "600", marginTop: 4 },
  liveHeroCost: { fontSize: 14, fontWeight: "800", marginTop: 8 },
  liveHereBtn: { marginTop: 16, borderRadius: 14, overflow: "hidden" },
  liveHereInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13 },
  liveHereText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  liveRestRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1 },
  liveRestTime: { fontSize: 12, fontWeight: "800", width: 96 },
  liveRestTitle: { fontSize: 15, fontWeight: "700", flex: 1 },
  liveRestCost: { fontSize: 13, fontWeight: "800" },
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

  adminBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  adminSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 16 },
  adminHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  adminTitle: { fontSize: 19, fontWeight: "800" },
  adminCloseBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  adminSection: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 18, marginBottom: 8 },
  adminHint: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  adminFieldRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  adminInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 10 },
  adminEmoji: { width: 52, height: 48, borderWidth: 1, borderRadius: 12, textAlign: "center", fontSize: 22 },
  adminTextarea: { minHeight: 80, textAlignVertical: "top" },
  coverSwatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  coverSwatchWrap: { borderRadius: 16, borderWidth: 2, borderColor: "transparent", padding: 2 },
  coverSwatch: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  adminSaveBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  adminSaveText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  adminPersonRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  adminPersonName: { flex: 1, fontSize: 15, fontWeight: "600" },
  adminCancelBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14, marginTop: 24 },
  adminCancelText: { fontSize: 15, fontWeight: "800" },
});
