import { useState, useCallback, useMemo, useRef, useEffect, createElement } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  Modal,
  Animated,
  LayoutAnimation,
  UIManager,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { LinearGradient } from "expo-linear-gradient";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useData, useAuth, dbEventToEvent } from "@/context/AppContext";
import { useMessages } from "@/context/MessagesContext";
import { useUserCache } from "@/context/UserCacheContext";
import { useEventStream } from "@/hooks/useEventStream";
import { UserAvatar } from "@/components/UserAvatar";
import AddressLink from "@/components/AddressLink";
import { IconPicker } from "@/components/IconPicker";
import { StopSheet } from "@/components/StopSheet";
import { IdeaSheet } from "@/components/IdeaSheet";
import { IdeaCard } from "@/components/IdeaCard";
import FriendPickerSheet from "@/components/FriendPickerSheet";
import { ChatMessages, ChatComposer } from "@/components/EventChatPanel";
import { EventCostsPanel } from "@/components/EventCostsPanel";
import { EventVaultPanel } from "@/components/EventVaultPanel";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { buildPlanIcs } from "@/lib/ics";
import { shareIcsFile } from "@/lib/shareIcs";
import { findMyConflicts, getPlanSpan } from "@/lib/conflicts";
import ConflictBanner from "@/components/ConflictBanner";
import { attendingIds } from "@/lib/eventUtils";
import { TAB_BAR_HEIGHT } from "@/constants/layout";
// Shared auth-race guard (see lib/vaultAuthRace.ts). Opening a trip directly on a
// cold start (deep link / push tap / past trip from the Past hub) fetches the
// single event; a pre-token-restore 401 must keep it loading + retry instead of
// flashing "This trip isn't available."
import {
  INITIAL_AUTH_RACE_STATE,
  type AuthRaceState,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  vaultRenderMode,
} from "@/lib/vaultAuthRace";
import type { Event, ItineraryStop, PlanIdea } from "@/types";
import {
  listIdeas,
  createIdea,
  patchIdea,
  deleteIdea,
  toggleIdeaVote,
  setIdeaStatus,
  toggleIdeaPin,
  reorderIdeas,
  type NewIdeaInput,
  type IdeaPatch,
} from "@/lib/ideas";
import {
  groupConfirmedIdeas,
  mergedDayKeys,
  sortPendingIdeas,
  applyVoteToggle,
  moveWithinGroup,
  GENERAL_GROUP,
  type PendingSort,
} from "@/lib/ideaUtils";
import {
  coverFor,
  parseISO,
  formatTripRange,
  tripNights,
  tripDayKeys,
  todayKey,
  formatDayHeading,
  groupStopsByDay,
  sumStopCosts,
  isHappeningNow,
  isTripPast,
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

// LayoutAnimation needs an explicit opt-in on old-architecture Android.
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** Short calendar-day label, e.g. "Mon, Jun 3". */
function formatPickedDay(d: Date): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Date → "YYYY-MM-DD" for an HTML <input type="date"> (web date fields). */
function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" from an HTML date input → local Date (noon, to dodge DST edges). */
function fromDateInputValue(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Combine a calendar day with a wall-clock hour → ISO. */
function dayAtHour(d: Date, hour: number): string {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 0, 0);
  return out.toISOString();
}

// Plain DOM style for the web-only <input type="date"> fields. Kept out of
// StyleSheet.create because it's passed straight to a DOM element on web.
const webDateInputStyle = {
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: 15,
  fontWeight: 700,
  fontFamily: "inherit",
  width: "100%",
  padding: 0,
  cursor: "pointer",
} as const;

/**
 * Animated vote heart: springs on tap for tactile feedback. The optimistic
 * voted/count values come from the parent; this only owns the animation.
 */
function VoteHeart({
  voted,
  count,
  tint,
  muted,
  border,
  onPress,
}: {
  voted: boolean;
  count: number;
  tint: string;
  muted: string;
  border: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = () => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, speed: 60, bounciness: 0 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 4, tension: 120 }),
    ]).start();
    onPress();
  };
  return (
    <TouchableOpacity
      onPress={press}
      activeOpacity={0.8}
      style={[voteHeartStyles.btn, { borderColor: voted ? tint : border, backgroundColor: voted ? tint + "18" : "transparent" }]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Ionicons name={voted ? "heart" : "heart-outline"} size={14} color={voted ? tint : muted} />
      </Animated.View>
      <Text style={[voteHeartStyles.text, { color: voted ? tint : muted }]}>{count > 0 ? count : "Vote"}</Text>
    </TouchableOpacity>
  );
}

const voteHeartStyles = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: "800" },
});

type TripTab = "itinerary" | "ideas" | "chat" | "costs" | "vault" | "budget" | "packing";

const TRIP_TABS: TripTab[] = ["itinerary", "ideas", "chat", "costs", "vault", "budget", "packing"];
const TRIP_TAB_LABELS: Record<TripTab, string> = {
  itinerary: "Itinerary",
  ideas: "💡 Ideas",
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
    events,
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
  const { resolveUser, prefetchUsers } = useUserCache();
  const { authToken } = useAuth();

  // Past trips live in the Plans→Past segment but are NOT in the upcoming-only
  // AppContext.events list (refreshEvents fetches /api/events without
  // includePast). Fall back to fetching the single event directly so opening a
  // past trip from the Past hub resolves instead of showing "not available".
  const ctxEvent = getEvent(id ?? "");
  const [fallbackEvent, setFallbackEvent] = useState<Event | null>(null);
  const event = ctxEvent ?? fallbackEvent;
  const [authRace, setAuthRace] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);

  // `track` = feed the auth-race guard. The cold-start hydrate + its retries pass
  // true (a pre-token-restore 401 keeps the screen loading instead of flashing
  // "This trip isn't available"); the pull-to-refresh path passes false.
  const fetchDetail = useCallback(async (track = false) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/events/${id}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        setFallbackEvent(dbEventToEvent(data));
        if (track) setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "ok" }));
        return;
      }
      if (track) {
        setAuthRace((prev) =>
          applyVaultFetchOutcome(prev, { kind: res.status === 401 ? "unauthorized" : "failure" }),
        );
      }
    } catch {
      // Network unavailable — keep whatever we have.
      if (track) setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "failure" }));
    }
  }, [id, authToken]);

  // Ideas live in their own table (not the events JSON), so they refresh
  // independently of event.version — piggybacked on every trip refresh below.
  const [ideas, setIdeas] = useState<PlanIdea[]>([]);
  const [ideasReadOnly, setIdeasReadOnly] = useState(false);
  const refreshIdeas = useCallback(async () => {
    if (!id || !authToken) return;
    const res = await listIdeas(id, authToken);
    if (res.ideas) {
      setIdeas(res.ideas);
      setIdeasReadOnly(!!res.readOnly);
    }
  }, [id, authToken]);
  useEffect(() => {
    void refreshIdeas();
  }, [refreshIdeas]);

  // Refresh both the shared list (drives upcoming trips reactively) and the
  // single-event fallback (drives past trips not present in that list).
  const refresh = useCallback(async () => {
    await Promise.all([refreshEvents(), fetchDetail(), refreshIdeas()]);
  }, [refreshEvents, fetchDetail, refreshIdeas]);

  // On mount / when the context misses (e.g. a past trip), hydrate the fallback.
  useEffect(() => {
    if (!ctxEvent && id && authToken) void fetchDetail(true);
  }, [ctxEvent, id, authToken, fetchDetail]);

  // Retry driver: while the fallback hydrate is auth-pending (401 before the
  // token restored), re-run it on a short cadence until an authenticated fetch
  // lands, then give up into a retryable error rather than an infinite spinner.
  useEffect(() => {
    if (ctxEvent) return; // context already has it — no fallback race to run.
    const decision = nextRetryDecision(authRace);
    if (decision.action === "give-up") {
      setAuthRace(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void fetchDetail(true); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [authRace, ctxEvent, fetchDetail]);

  const retryTrip = useCallback(() => {
    setAuthRace(resetAuthRaceState());
    void fetchDetail(true);
  }, [fetchDetail]);

  const [tab, setTab] = useState<TripTab>(
    TRIP_TABS.includes(tabParam as TripTab) ? (tabParam as TripTab) : "itinerary",
  );

  // T205: vault photo count for the past-trip recap strip (null = not loaded).
  const [recapPhotoCount, setRecapPhotoCount] = useState<number | null>(null);
  useEffect(() => {
    if (!event || !id || !authToken) return;
    if (!isTripPast(event)) return;
    fetch(`${API_BASE}/api/vault/photos?eventId=${id}`, { headers: buildAuthHeaders(authToken) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { photos?: unknown[] } | null) => {
        if (data && Array.isArray(data.photos)) setRecapPhotoCount(data.photos.length);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.endAt, id, authToken]);
  const { markEventChatRead } = useMessages();
  const lastMsgIso = event?.messages?.[event.messages.length - 1]?.createdAt;
  useEffect(() => {
    if (tab === "chat" && event) markEventChatRead(event.id, lastMsgIso);
  }, [tab, event?.id, lastMsgIso, markEventChatRead]);
  const [busy, setBusy] = useState(false);
  const [calBusy, setCalBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingStop, setEditingStop] = useState<ItineraryStop | null>(null);
  const [sheetDay, setSheetDay] = useState<string | null>(null);
  // Ideas UI state: suggest/edit sheet, board sort, archived fold, and which
  // confirmed-idea day group (day key or GENERAL_GROUP) is in reorder mode.
  const [ideaSheetOpen, setIdeaSheetOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<PlanIdea | null>(null);
  const [ideaSheetDay, setIdeaSheetDay] = useState<string | null>(null);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaSort, setIdeaSort] = useState<PendingSort>("votes");
  const [showArchivedIdeas, setShowArchivedIdeas] = useState(false);
  const [ideaReorderGroup, setIdeaReorderGroup] = useState<string | null>(null);
  const ideaVoteInFlight = useRef<Set<string>>(new Set());
  const [packingDraft, setPackingDraft] = useState("");
  // Optimistic UI overrides: applied instantly on tap, cleared when the server
  // truth arrives (event.version changes via refresh/SSE) or reverted on error.
  const [voteOverrides, setVoteOverrides] = useState<Record<string, boolean>>({});
  const [packOverrides, setPackOverrides] = useState<Record<string, boolean>>({});
  const eventVersion = ctxEvent?.version ?? fallbackEvent?.version;
  useEffect(() => {
    setVoteOverrides({});
    setPackOverrides({});
  }, [eventVersion]);
  const [liveView, setLiveView] = useState(false);
  const [arrivedIdx, setArrivedIdx] = useState(0);
  const [showInvitePicker, setShowInvitePicker] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [edit, setEdit] = useState({ title: "", location: "", description: "", emoji: "" });
  const [coverDraft, setCoverDraft] = useState("");
  // Editable trip date range (admin sheet). Seeded from the trip's startAt/endAt
  // when the sheet opens; saved back as startAt/endAt/eventAt on "Save changes".
  const [startDraft, setStartDraft] = useState<Date | null>(null);
  const [endDraft, setEndDraft] = useState<Date | null>(null);
  // Native date-range picker: which end of the range is being picked + scratch value.
  const [dateStep, setDateStep] = useState<"start" | "end" | null>(null);
  const [dateTmp, setDateTmp] = useState<Date>(new Date());

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

  // All trip participants in display order: squad members first, then direct invites.
  const allTripMembers = useMemo(() => {
    const sq = event ? getSquad(event.squadId) : undefined;
    const squadIds = sq?.memberIds ?? [];
    const extraIds = (event?.invitedUserIds ?? []).filter((uid) => !squadIds.includes(uid));
    const result: Array<{ user: ReturnType<typeof resolveUser>; isSquadMember: boolean }> = [];
    for (const uid of squadIds) result.push({ user: resolveUser(uid), isSquadMember: true });
    for (const uid of extraIds) result.push({ user: resolveUser(uid), isSquadMember: false });
    return result;
  }, [event, getSquad, resolveUser]);

  // Warm the user cache for everyone shown on this screen (members, invitees,
  // assignees, host) so their profile pictures resolve instead of falling back
  // to initials — the trip screen can be opened via deep link with a cold cache.
  useEffect(() => {
    const ids = new Set<string>(allTripMembers.map((m) => m.user.id));
    if (event?.hostId) ids.add(event.hostId);
    if (ids.size > 0) prefetchUsers([...ids]);
  }, [allTripMembers, event?.hostId, prefetchUsers]);

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

  const stops = event?.itinerary ?? [];

  // ── Lock-in moment (T203): flash a stop green when it flips proposed →
  // confirmed. Detected by diffing statuses across refreshes, so viewers who
  // see the change arrive via SSE get the same beat as the host who tapped it.
  // These hooks MUST live above the early "not available" return below —
  // otherwise a past trip hydrating via the fallback fetch changes the hook
  // order between renders and crashes the screen (React hooks-order error).
  const prevStopStatusRef = useRef<Record<string, string>>({});
  const [confirmedFlashId, setConfirmedFlashId] = useState<string | null>(null);
  const confirmFlash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const prev = prevStopStatusRef.current;
    const next: Record<string, string> = {};
    let flipped: string | null = null;
    for (const s of stops) {
      next[s.id] = s.status;
      if (prev[s.id] === "proposed" && s.status === "confirmed") flipped = s.id;
    }
    prevStopStatusRef.current = next;
    if (flipped) {
      setConfirmedFlashId(flipped);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      confirmFlash.setValue(0);
      Animated.sequence([
        Animated.timing(confirmFlash, { toValue: 1, duration: 250, useNativeDriver: false }),
        Animated.delay(900),
        Animated.timing(confirmFlash, { toValue: 0, duration: 450, useNativeDriver: false }),
      ]).start(() => setConfirmedFlashId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map((s) => `${s.id}:${s.status}`).join(",")]);

  if (!event || event.type !== "trip") {
    // Only the missing-event case (no ctx + fallback not hydrated) is subject to
    // the cold-start auth race. A resolved-but-wrong-type event is a genuine
    // "not a trip" and falls straight through to the not-available state.
    const notFoundMode = event
      ? "empty"
      : vaultRenderMode({
          loading: !ctxEvent && !!id && !!authToken && !authRace.authError,
          authPending: authRace.authPending,
          authError: authRace.authError,
          photoCount: 0,
        });
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: colors.background }]}>
        {notFoundMode === "loading" ? (
          <ActivityIndicator color={colors.primary} />
        ) : notFoundMode === "error" ? (
          <>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.textDim} />
            <Text style={[styles.missingText, { color: colors.mutedForeground }]}>Couldn't load this trip.</Text>
            <TouchableOpacity onPress={retryTrip} style={[styles.missingBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>Try again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Ionicons name="airplane-outline" size={44} color={colors.textDim} />
            <Text style={[styles.missingText, { color: colors.mutedForeground }]}>This trip isn't available.</Text>
            <TouchableOpacity onPress={() => router.replace("/(tabs)/events" as never)} style={[styles.missingBtn, { borderColor: colors.border }]}>
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>Back to Plans</Text>
            </TouchableOpacity>
          </>
        )}
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

  // Is the current user actually on this trip's roster?
  const isAttending = attendingIds(event, squad?.memberIds ?? []).includes(currentUser.id);

  // Private cross-squad conflict check — shown only to the affected user,
  // never blocks anything.
  const myConflicts = isAttending
    ? findMyConflicts({
        candidate: getPlanSpan(event),
        plans: events,
        userId: currentUser.id,
        squads,
        excludeId: event.id,
      })
    : [];

  const handleAddToCalendar = async () => {
    if (calBusy) return;
    const ics = buildPlanIcs(event);
    if (!ics) {
      Alert.alert("Can't add to calendar", "This trip doesn't have dates yet.");
      return;
    }
    setCalBusy(true);
    try {
      const res = await shareIcsFile(ics.filename, ics.content);
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Couldn't add to calendar", res.message ?? "Please try again.");
      }
    } catch {
      Alert.alert("Couldn't add to calendar", "Something went wrong. Please try again.");
    } finally {
      setCalBusy(false);
    }
  };

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
    setStartDraft(parseISO(event.startAt));
    setEndDraft(parseISO(event.endAt) ?? parseISO(event.startAt));
    setAdminOpen(true);
  };

  const saveDetails = () => {
    if (!edit.title.trim()) {
      Alert.alert("Missing info", "A trip needs a title.");
      return;
    }
    if (!startDraft) {
      Alert.alert("Missing dates", "A trip needs a start date.");
      return;
    }
    const end = endDraft ?? startDraft;
    if (end < startDraft) {
      Alert.alert("Check the dates", "The end date can't be before the start date.");
      return;
    }
    // Mirror create.tsx: startAt at 9am, endAt at 6pm on the last day, and
    // eventAt = startAt so reminder/visibility logic still has a value.
    const startISO = dayAtHour(startDraft, 9);
    const endISO = dayAtHour(end, 18);
    updateEvent(event.id, {
      title: edit.title.trim(),
      location: edit.location.trim(),
      description: edit.description.trim(),
      emoji: edit.emoji.trim() || event.emoji,
      coverStyle: coverDraft,
      startAt: startISO,
      endAt: endISO,
      eventAt: startISO,
      date: formatTripRange({ startAt: startISO, endAt: endISO }),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdminOpen(false);
  };

  const openDatePicker = (which: "start" | "end") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const seed = which === "start" ? startDraft : endDraft ?? startDraft;
    setDateTmp(seed ?? new Date());
    setDateStep(which);
  };

  const applyDate = (which: "start" | "end", d: Date) => {
    if (which === "start") {
      setStartDraft(d);
      // Keep the range valid: if the end is now before the start, snap it up.
      setEndDraft((prev) => (prev && prev < d ? d : prev));
    } else {
      setEndDraft(d);
    }
  };

  const confirmDate = (d: Date) => {
    if (dateStep) applyDate(dateStep, d);
    setDateStep(null);
  };

  const handleDateAndroid = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setDateStep(null); return; }
    confirmDate(d);
  };

  const onWebDateChange = (which: "start" | "end", value: string) => {
    const d = fromDateInputValue(value);
    if (d) applyDate(which, d);
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
  const packing = event.packing ?? [];
  const cover = coverFor(event.coverStyle);
  const nights = tripNights(event);
  const happening = isHappeningNow(event);
  const grouped = groupStopsByDay(stops);
  // Confirmed ideas merge into the itinerary day groups at RENDER level only:
  // stops always render first (untouched), then ideas by sortOrder. Idea-only
  // day keys (legacy trips out of range) append after the known range.
  const ideaGroups = groupConfirmedIdeas(ideas);
  const itineraryDayKeys = mergedDayKeys(dayKeys, ideaGroups);
  const pendingIdeas = sortPendingIdeas(ideas.filter((i) => i.status === "pending"), ideaSort);
  const archivedIdeas = ideas.filter((i) => i.status === "archived");
  const confirmedIdeaCount = ideas.filter((i) => i.status === "confirmed").length;
  const hasConfirmedIdeas = confirmedIdeaCount > 0;

  /** A confirmed idea inside an itinerary day group (or the General section). */
  const renderIdeaInline = (idea: PlanIdea, groupKey: string, group: PlanIdea[]) => {
    const idx = group.findIndex((g) => g.id === idea.id);
    return (
      <IdeaCard
        key={idea.id}
        idea={idea}
        variant="inline"
        isMine={idea.submittedBy?.id === currentUser.id}
        canManage={canManage}
        readOnly={ideasReadOnly}
        reordering={ideaReorderGroup === groupKey}
        canMoveUp={idx > 0}
        canMoveDown={idx >= 0 && idx < group.length - 1}
        onEdit={() => openEditIdea(idea)}
        onDelete={() => confirmDeleteIdea(idea)}
        onUnconfirm={() => runIdeaStatus(idea, "pending")}
        onMove={(dir) => handleIdeaMove(groupKey, group, idea.id, dir)}
        onEnterReorder={group.length > 1 ? () => setIdeaReorderGroup(groupKey) : undefined}
      />
    );
  };

  /** "Done reordering" pill shown while a day group's ideas are in reorder mode. */
  const renderReorderDone = (groupKey: string) =>
    ideaReorderGroup === groupKey ? (
      <TouchableOpacity
        onPress={() => setIdeaReorderGroup(null)}
        style={{
          alignSelf: "flex-end",
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: colors.primary + "18",
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 7,
          marginBottom: 6,
        }}
        accessibilityRole="button"
        accessibilityLabel="Done reordering"
      >
        <Ionicons name="checkmark" size={15} color={colors.primary} />
        <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>Done reordering</Text>
      </TouchableOpacity>
    ) : null;
  const costs = sumStopCosts(stops);

  const confirmUninvite = (u: ReturnType<typeof resolveUser>) => {
    const firstName = u.name.split(" ")[0];
    const isSelf = u.id === currentUser.id;
    Alert.alert(
      isSelf ? "Leave trip" : `Remove ${firstName}`,
      isSelf
        ? `Leave "${event.title}"? You can rejoin if invited again.`
        : `Remove ${firstName} from "${event.title}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: isSelf ? "Leave" : "Remove",
          style: "destructive",
          onPress: () => {
            void uninviteFromEvent(event.id, u.id).then((r) => {
              if (r.error) Alert.alert("Couldn't remove", r.error);
              else {
                void refresh();
                if (isSelf) {
                  if (router.canGoBack()) router.back();
                  else router.replace("/(tabs)/events" as never);
                }
              }
            });
          },
        },
      ],
    );
  };

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

  // ── Ideas handlers ─────────────────────────────────────────────────────
  const runIdeaMut = async (fn: () => Promise<{ error?: string }>) => {
    if (ideaBusy) return;
    setIdeaBusy(true);
    try {
      const res = await fn();
      if (res.error) Alert.alert("Something went wrong", res.error);
      await refreshIdeas();
    } finally {
      setIdeaBusy(false);
    }
  };

  const openSuggestIdea = (day: string | null = null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingIdea(null);
    setIdeaSheetDay(day);
    setIdeaSheetOpen(true);
  };

  const openEditIdea = (idea: PlanIdea) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingIdea(idea);
    setIdeaSheetDay(idea.suggestedDate);
    setIdeaSheetOpen(true);
  };

  const submitIdea = (data: NewIdeaInput | IdeaPatch, isEdit: boolean) => {
    setIdeaSheetOpen(false);
    void runIdeaMut(async () => {
      if (isEdit && editingIdea) return patchIdea(event.id, editingIdea.id, authToken, data as IdeaPatch);
      return createIdea(event.id, authToken, data as NewIdeaInput);
    });
  };

  // Optimistic vote toggle: flip locally + haptic, reconcile with the server
  // response (or a refetch on failure). One in-flight toggle per idea — rapid
  // double-taps otherwise race, letting a delayed older response overwrite the
  // newer server state.
  const handleIdeaVote = (idea: PlanIdea) => {
    if (ideaVoteInFlight.current.has(idea.id)) return;
    ideaVoteInFlight.current.add(idea.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIdeas((prev) => applyVoteToggle(prev, idea.id));
    void (async () => {
      try {
        const res = await toggleIdeaVote(event.id, idea.id, authToken);
        if (res.idea) {
          const serverIdea = res.idea;
          setIdeas((prev) => prev.map((i) => (i.id === serverIdea.id ? serverIdea : i)));
        } else {
          await refreshIdeas();
          if (res.error) Alert.alert("Couldn't vote", res.error);
        }
      } finally {
        ideaVoteInFlight.current.delete(idea.id);
      }
    })();
  };

  const confirmDeleteIdea = (idea: PlanIdea) => {
    Alert.alert("Delete idea", `Delete "${idea.title}"? Its votes go with it.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void runIdeaMut(() => deleteIdea(event.id, idea.id, authToken)),
      },
    ]);
  };

  const runIdeaStatus = (idea: PlanIdea, status: PlanIdea["status"]) => {
    if (status === "confirmed") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void runIdeaMut(() => setIdeaStatus(event.id, idea.id, authToken, status));
  };

  const handleIdeaPin = (idea: PlanIdea) => {
    void runIdeaMut(() => toggleIdeaPin(event.id, idea.id, authToken));
  };

  // Arrow-based reorder: swap within the group locally-computed order, send the
  // FULL group id list (server rejects partial payloads).
  const handleIdeaMove = (groupKey: string, group: PlanIdea[], ideaId: string, dir: "up" | "down") => {
    const ids = moveWithinGroup(group, ideaId, dir);
    if (!ids) return;
    Haptics.selectionAsync();
    void runIdeaMut(() =>
      reorderIdeas(event.id, authToken, groupKey === GENERAL_GROUP ? null : groupKey, ids),
    );
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

  // Optimistic vote toggle: flip locally + haptic, fire the request, reconcile
  // via refresh (version bump clears the override). Revert silently on conflict.
  const handleVote = (stop: ItineraryStop) => {
    const currentlyVoted = voteOverrides[stop.id] ?? stop.votes.includes(currentUser.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVoteOverrides((o) => ({ ...o, [stop.id]: !currentlyVoted }));
    void (async () => {
      const res = await voteStop(event.id, stop.id, authToken, event.version);
      if (res.conflict || res.error) {
        setVoteOverrides((o) => {
          const { [stop.id]: _omit, ...rest } = o;
          return rest;
        });
        await refresh();
        if (res.error && !res.conflict) Alert.alert("Something went wrong", res.error);
      } else {
        await refresh();
      }
    })();
  };

  // Optimistic packing check-off: instant strikethrough + light haptic;
  // revert with a heads-up if the server rejects it.
  const handleTogglePacking = (item: { id: string; done: boolean }) => {
    const done = packOverrides[item.id] ?? item.done;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Animate the row "sinking" to the checked group at the bottom.
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPackOverrides((o) => ({ ...o, [item.id]: !done }));
    void (async () => {
      const res = await patchPacking(event.id, item.id, authToken, { done: !done }, event.version);
      if (res.conflict || res.error) {
        setPackOverrides((o) => {
          const { [item.id]: _omit, ...rest } = o;
          return rest;
        });
        await refresh();
        Alert.alert("Couldn't update", res.conflict ? "Someone else updated this trip — we refreshed it for you." : (res.error ?? "Please try again."));
      } else {
        await refresh();
      }
    })();
  };

  const renderStop = (stop: ItineraryStop) => {
    const meta = STOP_CATEGORY_META[stop.category];
    const tint = colors[meta.colorKey];
    const proposed = stop.status === "proposed";
    // Apply optimistic override on top of the server truth.
    const override = voteOverrides[stop.id];
    const voted = override ?? stop.votes.includes(currentUser.id);
    const displayVotes =
      override === undefined
        ? stop.votes
        : override
          ? [...new Set([...stop.votes, currentUser.id])]
          : stop.votes.filter((v) => v !== currentUser.id);
    const mine = stop.createdBy === currentUser.id;
    const isFlashing = confirmedFlashId === stop.id;
    const Wrapper = isFlashing ? Animated.View : View;
    return (
      <Wrapper
        key={stop.id}
        style={[
          styles.stopRow,
          { borderColor: colors.border, backgroundColor: colors.card },
          isFlashing
            ? {
                borderColor: colors.green,
                backgroundColor: confirmFlash.interpolate({
                  inputRange: [0, 1],
                  outputRange: [colors.card, colors.green + "26"],
                }) as unknown as string,
              }
            : null,
        ]}
      >
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
          {proposed && stop.createdBy ? (
            <Text style={[styles.stopSuggestedBy, { color: colors.textDim }]}>
              Suggested by {mine ? "you" : resolveUser(stop.createdBy).name.split(" ")[0]}
            </Text>
          ) : null}
          {stop.placeName ? <Text style={[styles.stopPlace, { color: colors.mutedForeground }]}>{stop.placeName}</Text> : null}
          {stop.address ? (
            <AddressLink
              location={stop.address}
              textStyle={[styles.stopAddress, { color: colors.textDim }]}
              iconColor={colors.primary}
              iconSize={12}
            />
          ) : null}
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
              <VoteHeart
                voted={voted}
                count={displayVotes.length}
                tint={colors.primary}
                muted={colors.mutedForeground}
                border={colors.border}
                onPress={() => handleVote(stop)}
              />
            ) : null}
            {proposed && displayVotes.length > 0 ? (
              <View style={styles.voterStack}>
                {displayVotes.slice(0, 3).map((uid, i) => {
                  const u = resolveUser(uid);
                  return (
                    <View key={uid} style={[styles.voterAvatar, { marginLeft: i === 0 ? 0 : -8, borderColor: colors.card }]}>
                      <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={20} fontSize={8} />
                    </View>
                  );
                })}
                {displayVotes.length > 3 ? (
                  <Text style={[styles.voterOverflow, { color: colors.mutedForeground }]}>+{displayVotes.length - 3}</Text>
                ) : null}
              </View>
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
            <TouchableOpacity
              onPress={() => confirmDelete(stop)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`Delete stop ${stop.title}`}
            >
              <Ionicons name="trash-outline" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ) : null}
      </Wrapper>
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
                  <LinearGradient colors={["#FF6B2C", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.liveHereInner}>
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
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: colors.background }]}>
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
                <TouchableOpacity
                  onPress={openAdmin}
                  style={styles.coverIconBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  accessibilityRole="button"
                  accessibilityLabel="Manage trip settings"
                >
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

        {isTripPast(event) && (() => {
          const parts: { icon: string; label: string }[] = [];
          if (recapPhotoCount !== null && recapPhotoCount > 0) {
            parts.push({ icon: "images-outline", label: `${recapPhotoCount} photo${recapPhotoCount === 1 ? "" : "s"}` });
          }
          parts.push({ icon: "people-outline", label: `${allTripMembers.length} went` });
          if (costs.confirmed > 0) parts.push({ icon: "card-outline", label: `$${costs.confirmed.toFixed(0)} spent` });
          return (
            <View style={[styles.recapStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.recapTitle, { color: colors.mutedForeground }]}>How it went</Text>
              <View style={styles.recapRow}>
                {parts.map((p) => (
                  <View key={p.label} style={styles.recapItem}>
                    <Ionicons name={p.icon as never} size={14} color={colors.primary} />
                    <Text style={[styles.recapItemText, { color: colors.foreground }]}>{p.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* Who's coming */}
        <View style={styles.invitePanel}>
          <Text style={[styles.inviteHeading, { color: colors.foreground }]}>Who's coming</Text>
          <View style={styles.memberGrid}>
            {allTripMembers.map(({ user: u, isSquadMember }) => {
              const isSelf = u.id === currentUser.id;
              const canRemove = !isSquadMember && (isHost || isSelf);
              return (
                <View key={u.id} style={styles.memberCell}>
                  <TouchableOpacity
                    onPress={!isSelf ? () => router.push(`/user/${u.id}` as never) : undefined}
                    activeOpacity={isSelf ? 1 : 0.7}
                    style={{ alignItems: "center" }}
                  >
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={44} fontSize={15} />
                  </TouchableOpacity>
                  <Text style={[styles.memberCellName, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {isSelf ? "You" : u.name.split(" ")[0]}
                  </Text>
                  {u.id === event.hostId && (
                    <View style={[styles.memberHostBadge, { backgroundColor: colors.primary + "22" }]}>
                      <Text style={[styles.memberHostBadgeText, { color: colors.primary }]}>host</Text>
                    </View>
                  )}
                  {canRemove && (
                    <TouchableOpacity
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); confirmUninvite(u); }}
                      style={[styles.memberRemoveBtn, { backgroundColor: colors.destructive }]}
                      hitSlop={{ top: 14, right: 14, bottom: 14, left: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${u.name} from trip`}
                    >
                      <Ionicons name="close" size={10} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {canInvite && (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowInvitePicker(true); }}
                style={{ alignItems: "center" }}
                activeOpacity={0.7}
              >
                <View style={[styles.memberAddCircle, { borderColor: colors.border }]}>
                  <Ionicons name="add" size={22} color={colors.mutedForeground} />
                </View>
                <Text style={[styles.memberCellName, { color: colors.mutedForeground }]}>Invite</Text>
              </TouchableOpacity>
            )}
          </View>
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
            <EventVaultPanel event={event} authToken={authToken} />
          </View>
        ) : null}

        {/* ITINERARY */}
        {tab === "itinerary" ? (
          <View style={styles.tabBody}>

            {myConflicts.length > 0 && (
              <ConflictBanner conflicts={myConflicts} style={{ marginBottom: 12 }} />
            )}

            <TouchableOpacity
              onPress={handleAddToCalendar}
              disabled={calBusy}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                marginBottom: 14,
                opacity: calBusy ? 0.6 : 1,
              }}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 14 }}>Add to Calendar</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Trip dates + timed stops as one calendar file</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>

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

            {stops.length === 0 && !hasConfirmedIdeas ? (
              <View style={styles.empty}>
                <Ionicons name="map-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No stops yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Build the plan day by day. Add your first stop to get the squad excited.
                </Text>
              </View>
            ) : (
              <>
                {itineraryDayKeys.map((key, i) => {
                  const dayStops = grouped[key] ?? [];
                  const dayIdeas = ideaGroups.byDay[key] ?? [];
                  const heading = formatDayHeading(key, i);
                  // Idea-only days appended past the trip range must NOT be
                  // labelled "Day N" (they aren't trip days) — show the date.
                  const isExtraDay = i >= dayKeys.length;
                  const isToday = key === today;
                  return (
                    <View key={key} style={styles.daySection}>
                      <View style={styles.dayHeader}>
                        <View>
                          <Text style={[styles.dayLabel, { color: isToday ? colors.primary : colors.foreground }]}>
                            {isExtraDay ? heading.sub : heading.label}{isToday ? " · Today" : ""}
                          </Text>
                          <Text style={[styles.daySub, { color: colors.mutedForeground }]}>
                            {isExtraDay ? "Voted in — outside the trip dates" : heading.sub}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => openAddStop(key)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={styles.dayAddBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Add stop on ${heading.label}`}
                        >
                          <Ionicons name="add" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      </View>
                      {dayStops.length === 0 && dayIdeas.length === 0 ? (
                        <TouchableOpacity onPress={() => openAddStop(key)} style={[styles.dayEmpty, { borderColor: colors.border }]}>
                          <Text style={[styles.dayEmptyText, { color: colors.textDim }]}>Nothing planned — tap to add</Text>
                        </TouchableOpacity>
                      ) : (
                        <>
                          {dayStops.map(renderStop)}
                          {renderReorderDone(key)}
                          {dayIdeas.map((idea) => renderIdeaInline(idea, key, dayIdeas))}
                        </>
                      )}
                    </View>
                  );
                })}
                {ideaGroups.general.length > 0 ? (
                  <View style={styles.daySection}>
                    <View style={styles.dayHeader}>
                      <View>
                        <Text style={[styles.dayLabel, { color: colors.foreground }]}>Anytime</Text>
                        <Text style={[styles.daySub, { color: colors.mutedForeground }]}>Voted in — no day picked yet</Text>
                      </View>
                    </View>
                    {renderReorderDone(GENERAL_GROUP)}
                    {ideaGroups.general.map((idea) => renderIdeaInline(idea, GENERAL_GROUP, ideaGroups.general))}
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {/* IDEAS — suggest & vote board */}
        {tab === "ideas" ? (
          <View style={styles.tabBody}>
            {ideasReadOnly ? (
              <View style={[styles.todayCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  This trip has wrapped — ideas are read-only.
                </Text>
              </View>
            ) : null}

            {pendingIdeas.length > 1 ? (
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {(["votes", "created"] as PendingSort[]).map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => { Haptics.selectionAsync(); setIdeaSort(s); }}
                    style={{
                      borderRadius: 16,
                      borderWidth: 1.5,
                      borderColor: ideaSort === s ? colors.primary : colors.border,
                      backgroundColor: ideaSort === s ? colors.primary + "18" : "transparent",
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                    }}
                  >
                    <Text style={{ color: ideaSort === s ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: "800" }}>
                      {s === "votes" ? "Top voted" : "Newest"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {pendingIdeas.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="bulb-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No ideas yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Be the first to suggest something. The squad votes, organizers lock it in.
                </Text>
              </View>
            ) : (
              pendingIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  variant="board"
                  isMine={idea.submittedBy?.id === currentUser.id}
                  canManage={canManage}
                  readOnly={ideasReadOnly}
                  onVote={() => handleIdeaVote(idea)}
                  onEdit={() => openEditIdea(idea)}
                  onDelete={() => confirmDeleteIdea(idea)}
                  onConfirm={() => runIdeaStatus(idea, "confirmed")}
                  onArchive={() => runIdeaStatus(idea, "archived")}
                  onPin={() => handleIdeaPin(idea)}
                />
              ))
            )}

            {hasConfirmedIdeas ? (
              <TouchableOpacity
                onPress={() => { Haptics.selectionAsync(); setTab("itinerary"); }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  borderWidth: 1,
                  borderColor: colors.green + "55",
                  backgroundColor: colors.green + "10",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginTop: 4,
                }}
              >
                <Ionicons name="checkmark-circle" size={16} color={colors.green} />
                <Text style={{ color: colors.green, fontSize: 13, fontWeight: "700", flex: 1 }}>
                  {confirmedIdeaCount} confirmed {confirmedIdeaCount === 1 ? "idea is" : "ideas are"} on the itinerary
                </Text>
                <Ionicons name="chevron-forward" size={14} color={colors.green} />
              </TouchableOpacity>
            ) : null}

            {archivedIdeas.length > 0 ? (
              <View style={{ marginTop: 16 }}>
                <TouchableOpacity
                  onPress={() => { Haptics.selectionAsync(); setShowArchivedIdeas((v) => !v); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}
                >
                  <Ionicons name={showArchivedIdeas ? "chevron-down" : "chevron-forward"} size={14} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Archived ({archivedIdeas.length})
                  </Text>
                </TouchableOpacity>
                {showArchivedIdeas
                  ? archivedIdeas.map((idea) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        variant="board"
                        isMine={idea.submittedBy?.id === currentUser.id}
                        canManage={canManage}
                        readOnly={ideasReadOnly}
                        onReactivate={() => runIdeaStatus(idea, "pending")}
                        onDelete={() => confirmDeleteIdea(idea)}
                      />
                    ))
                  : null}
              </View>
            ) : null}
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
              <View style={styles.empty}>
                <Ionicons name="cash-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No costs yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Add estimated costs to stops and they'll roll up here.
                </Text>
              </View>
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
                {(() => {
                  const packedCount = packing.filter((p) => packOverrides[p.id] ?? p.done).length;
                  const allPacked = packedCount === packing.length;
                  return (
                    <>
                      <Text style={[styles.packCount, { color: allPacked ? colors.green : colors.mutedForeground }]}>
                        {allPacked ? "All packed 🎒" : `${packedCount} of ${packing.length} packed`}
                      </Text>
                      <View style={[styles.packBarTrack, { backgroundColor: colors.border }]}>
                        <View
                          style={[
                            styles.packBarFill,
                            { backgroundColor: colors.green, width: `${Math.round((packedCount / packing.length) * 100)}%` },
                          ]}
                        />
                      </View>
                    </>
                  );
                })()}
                {[...packing]
                  .sort((a, b) => {
                    const aDone = packOverrides[a.id] ?? a.done;
                    const bDone = packOverrides[b.id] ?? b.done;
                    // Unchecked first; stable within each group.
                    return Number(aDone) - Number(bDone);
                  })
                  .map((item) => {
                  const done = packOverrides[item.id] ?? item.done;
                  return (
                  <View key={item.id} style={[styles.packRow, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity
                      onPress={() => handleTogglePacking(item)}
                      hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
                      style={styles.packToggle}
                    >
                      <View
                        style={[styles.packCheck, { borderColor: done ? colors.green : colors.border, backgroundColor: done ? colors.green : "transparent" }]}
                      >
                        {done ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                      </View>
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={[styles.packLabel, { color: done ? colors.mutedForeground : colors.foreground, textDecorationLine: done ? "line-through" : "none" }]}
                      >
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
                  );
                })}
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
          style={[styles.fab, { bottom: insets.bottom + 24 + (Platform.OS === "web" ? TAB_BAR_HEIGHT : 0) }]}
        >
          <LinearGradient colors={["#FF6B2C", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
            <Ionicons name="add" size={26} color="#fff" />
            <Text style={styles.fabText}>Add stop</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}

      {/* FAB for ideas — anyone with access can suggest (hidden once read-only) */}
      {tab === "ideas" && !ideasReadOnly ? (
        <TouchableOpacity
          onPress={() => openSuggestIdea(null)}
          activeOpacity={0.9}
          style={[styles.fab, { bottom: insets.bottom + 24 + (Platform.OS === "web" ? TAB_BAR_HEIGHT : 0) }]}
        >
          <LinearGradient colors={["#FF6B2C", "#FF8050"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabInner}>
            <Ionicons name="bulb" size={22} color="#fff" />
            <Text style={styles.fabText}>Suggest idea</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : null}


      <StopSheet
        visible={sheetOpen}
        dayKeys={dayKeys}
        defaultDay={sheetDay ?? dayKeys[0] ?? today}
        editing={editingStop}
        saving={busy}
        canConfirm={canManage}
        members={memberOptions}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitStop}
      />

      <IdeaSheet
        visible={ideaSheetOpen}
        dayKeys={dayKeys}
        defaultDay={ideaSheetDay}
        isTrip
        editing={editingIdea}
        saving={ideaBusy}
        onClose={() => setIdeaSheetOpen(false)}
        onSubmit={submitIdea}
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
              <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Icon</Text>
              <View style={{ marginBottom: 14 }}>
                <IconPicker value={edit.emoji} onChange={(e) => setEdit((s) => ({ ...s, emoji: e }))} />
              </View>
              <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Details</Text>
              <TextInput
                value={edit.title}
                onChangeText={(t) => setEdit((e) => ({ ...e, title: t }))}
                placeholder="Trip title"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.adminInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]}
              />
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

              {/* Dates */}
              <Text style={[styles.adminSection, { color: colors.mutedForeground }]}>Dates</Text>
              <View style={styles.rangeRow}>
                <View style={[styles.rangeBtn, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>Start</Text>
                  {Platform.OS === "web" ? (
                    createElement("input", {
                      type: "date",
                      value: toDateInputValue(startDraft),
                      max: toDateInputValue(endDraft),
                      onChange: (e: { target: { value: string } }) => onWebDateChange("start", e.target.value),
                      style: { ...webDateInputStyle, color: colors.foreground },
                    })
                  ) : (
                    <TouchableOpacity onPress={() => openDatePicker("start")} activeOpacity={0.8}>
                      <Text style={[styles.rangeValue, { color: startDraft ? colors.foreground : colors.mutedForeground }]}>
                        {startDraft ? formatPickedDay(startDraft) : "Pick a date"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={[styles.rangeBtn, { borderColor: colors.border, backgroundColor: colors.card }]}>
                  <Text style={[styles.rangeLabel, { color: colors.mutedForeground }]}>End</Text>
                  {Platform.OS === "web" ? (
                    createElement("input", {
                      type: "date",
                      value: toDateInputValue(endDraft),
                      min: toDateInputValue(startDraft),
                      onChange: (e: { target: { value: string } }) => onWebDateChange("end", e.target.value),
                      style: { ...webDateInputStyle, color: colors.foreground },
                    })
                  ) : (
                    <TouchableOpacity onPress={() => openDatePicker("end")} activeOpacity={0.8}>
                      <Text style={[styles.rangeValue, { color: endDraft ? colors.foreground : colors.mutedForeground }]}>
                        {endDraft ? formatPickedDay(endDraft) : "Pick a date"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              {startDraft ? (
                <Text style={[styles.rangePreview, { color: colors.mutedForeground }]}>
                  {formatTripRange({ startAt: dayAtHour(startDraft, 9), endAt: dayAtHour(endDraft ?? startDraft, 18) })}
                </Text>
              ) : null}

              <TouchableOpacity onPress={saveDetails} disabled={busy} activeOpacity={0.85} style={[styles.adminSaveBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
                {busy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.adminSaveText}>Save changes</Text>
                )}
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
                <TouchableOpacity onPress={confirmCancelTrip} disabled={busy} activeOpacity={0.85} style={[styles.adminCancelBtn, { borderColor: colors.destructive, opacity: busy ? 0.6 : 1 }]}>
                  {busy ? (
                    <ActivityIndicator size="small" color={colors.destructive} />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                      <Text style={[styles.adminCancelText, { color: colors.destructive }]}>Cancel trip</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </ScrollView>
          </View>
          {/* Date picker rendered IN-SHEET (not a nested Modal) to avoid iOS stacked-modal freeze */}
          {dateStep && Platform.OS === "ios" ? (
            <View style={styles.pickerOverlay}>
              <View style={[styles.pickerSheet, { backgroundColor: colors.surface }]}>
                <View style={styles.pickerToolbar}>
                  <TouchableOpacity onPress={() => setDateStep(null)} hitSlop={8}>
                    <Text style={[styles.pickerBtn, { color: colors.mutedForeground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                    {dateStep === "start" ? "Start date" : "End date"}
                  </Text>
                  <TouchableOpacity onPress={() => confirmDate(dateTmp)} hitSlop={8}>
                    <Text style={[styles.pickerBtn, { color: colors.primary, fontWeight: "800" }]}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={dateTmp}
                  mode="date"
                  display="spinner"
                  minimumDate={dateStep === "end" ? startDraft ?? undefined : undefined}
                  onChange={(_, d) => { if (d) setDateTmp(d); }}
                  themeVariant="dark"
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      {/* Android native date dialog (safe outside the modal; web uses inline <input type="date">) */}
      {dateStep && Platform.OS === "android" ? (
        <DateTimePicker
          value={dateTmp}
          mode="date"
          display="default"
          minimumDate={dateStep === "end" ? startDraft ?? undefined : undefined}
          onChange={handleDateAndroid}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  missingText: { fontSize: 15, fontWeight: "600" },
  missingBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10 },

  invitePanel: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 10 },
  recapStrip: { marginHorizontal: 20, marginTop: 14, borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  recapTitle: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  recapRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  recapItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  recapItemText: { fontSize: 13, fontWeight: "700" },
  inviteHeading: { fontSize: 15, fontWeight: "700" },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  memberCell: { alignItems: "center", paddingVertical: 4, paddingHorizontal: 6, position: "relative" },
  memberCellName: { fontSize: 11, fontWeight: "600", textAlign: "center", marginTop: 5, maxWidth: 56 },
  memberHostBadge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, marginTop: 2 },
  memberHostBadgeText: { fontSize: 9, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  memberRemoveBtn: { position: "absolute", top: 2, right: 2, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  memberAddCircle: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },

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
  stopSuggestedBy: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  packBarTrack: { height: 4, borderRadius: 2, overflow: "hidden", marginBottom: 10 },
  packBarFill: { height: 4, borderRadius: 2 },
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
  voterStack: { flexDirection: "row", alignItems: "center" },
  voterAvatar: { borderWidth: 2, borderRadius: 12 },
  voterOverflow: { fontSize: 11, fontWeight: "800", marginLeft: 4 },
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

  fab: { position: "absolute", right: 20, borderRadius: 26, overflow: "hidden", shadowColor: "#FF6B2C", shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
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
  rangeRow: { flexDirection: "row", gap: 10 },
  rangeBtn: { flex: 1, borderRadius: 13, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11 },
  rangeLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 },
  rangeValue: { fontSize: 15, fontWeight: "700" },
  rangePreview: { fontSize: 13, fontWeight: "700", marginTop: 10 },
  pickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  pickerBtn: { minWidth: 60, fontSize: 16 },
  pickerTitle: { fontSize: 16, fontWeight: "700" },
  adminSaveBtn: { borderRadius: 14, paddingVertical: 14, alignItems: "center", marginTop: 18 },
  adminSaveText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  adminPersonRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  adminPersonName: { flex: 1, fontSize: 15, fontWeight: "600" },
  adminCancelBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14, marginTop: 24 },
  adminCancelText: { fontSize: 15, fontWeight: "800" },
});
