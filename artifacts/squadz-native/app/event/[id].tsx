import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Platform,
  Share,
  Alert,
  ActivityIndicator,
  Switch,
  Animated,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { SettleUp } from "@/components/SettleUp";
import type { Event as SquadzEvent } from "@/types";
import { parseEventStart } from "@/lib/calendar";
import { buildPlanIcs } from "@/lib/ics";
import { shareIcsFile } from "@/lib/shareIcs";
import { findMyConflicts, getPlanSpan } from "@/lib/conflicts";
import ConflictBanner from "@/components/ConflictBanner";
import { scheduleRsvpReminder } from "@/lib/reminders";
import { sendManualReminder } from "@/lib/api";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useEventStream } from "@/hooks/useEventStream";
import { useData, useAuth, dbEventToEvent } from "@/context/AppContext";
import { useMessages } from "@/context/MessagesContext";
import { FindTimeChooser } from "@/components/FindTimeChooser";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { ProAvatar } from "@/components/ProAvatar";
import { ContactSheet } from "@/components/ContactSheet";
import AddressLink from "@/components/AddressLink";
import FriendPickerSheet from "@/components/FriendPickerSheet";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { claimOnce } from "@/lib/seenFlags";
import { goingCount } from "@/lib/eventUtils";
import type { RsvpStatus } from "@/types";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { useTips } from "@/context/TipsContext";
import { IconPicker } from "@/components/IconPicker";
import { EventVaultPanel } from "@/components/EventVaultPanel";
// Shared auth-race guard (see lib/vaultAuthRace.ts). Opening an event directly on
// a cold start (deep link / push tap) can 401 before the token restores and
// AppContext hasn't loaded the event yet; keep it loading + retry instead of
// flashing "Event not found".
import {
  vaultRenderMode,
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

type EventTab = "overview" | "guests" | "tasks" | "food" | "costs" | "chat" | "photos" | "admin";

/** "Sat, Jun 7 · 8:00 PM" label for an event end time (ISO). */
function formatEndLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${h12}:${mm} ${ampm}`;
}

/**
 * Human-friendly countdown to an event start. Returns null when the event is
 * more than ~10 days out (no urgency) or already finished (>3h past start).
 */
function formatCountdown(target: Date, now: number): { label: string; soon: boolean } | null {
  const diff = target.getTime() - now;
  const HOUR = 3600_000;
  const DAY = 24 * HOUR;
  if (diff < -3 * HOUR) return null; // event is over
  if (diff <= 0) return { label: "Happening now", soon: true };
  if (diff > 10 * DAY) return null; // too far out to bother
  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  const mins = Math.floor((diff % HOUR) / 60_000);
  let label: string;
  if (days >= 1) label = `Starts in ${days}d ${hours}h`;
  else if (hours >= 1) label = `Starts in ${hours}h ${mins}m`;
  else label = `Starts in ${mins}m`;
  return { label, soon: diff <= DAY };
}

const STATUS_LABEL: Record<RsvpStatus, string> = {
  going: "Going",
  maybe: "Maybe",
  notgoing: "Can't go",
};

export default function EventDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const {
    getEvent,
    events,
    squads,
    setRsvp,
    updateEvent,
    cancelEvent,
    toggleTask,
    claimTask,
    addTask,
    addCost,
    updateCost,
    deleteCost,
    markSharePaid,
    confirmShare,
    ownPaymentHandles,
    fetchPaymentHandles,
    addPoll,
    votePoll,
    setPollClosed,
    sendMessage,
    refreshEvents,
    inviteToEvent,
    uninviteFromEvent,
    getSquad,
    currentUser,
    conflictEventId,
    conflictSnapshot,
    clearConflictEvent,
    addEventCoAdmin,
    removeEventCoAdmin,
    eventsLoading,
    eventsAuthPending,
    eventsAuthError,
    retryEvents,
  } = useData();

  // Past events are NOT in the upcoming-only AppContext.events list. When
  // getEvent returns undefined (past event, deep-link cold-start, etc.),
  // fetch /api/events/:id directly — mirroring the pattern in trip/[id].tsx.
  // Declared early — needed by fetchFallbackEvent below.
  const { authToken } = useAuth();

  // Past events are NOT in the upcoming-only AppContext.events list. When
  // getEvent returns undefined (past event, deep-link cold-start, etc.),
  // fetch /api/events/:id directly — mirroring the pattern in trip/[id].tsx.
  const ctxEvent = getEvent(id ?? "");
  const [fallbackEvent, setFallbackEvent] = useState<import("@/types").Event | null>(null);
  const [fallbackAuthRace, setFallbackAuthRace] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const event = ctxEvent ?? fallbackEvent;

  const fetchFallbackEvent = useCallback(async (track = false) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/events/${id}`, {
        headers: buildAuthHeaders(authToken),
      });
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        setFallbackEvent(dbEventToEvent(data));
        if (track) setFallbackAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "ok" }));
        return;
      }
      if (track) {
        setFallbackAuthRace((prev) =>
          applyVaultFetchOutcome(prev, { kind: res.status === 401 ? "unauthorized" : "failure" }),
        );
      }
    } catch {
      if (track) setFallbackAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "failure" }));
    }
  }, [id, authToken]);

  // On mount / when context misses (past event), hydrate the fallback.
  useEffect(() => {
    if (!ctxEvent && id && authToken) void fetchFallbackEvent(true);
  }, [ctxEvent, id, authToken, fetchFallbackEvent]);

  // Retry driver: re-run on a short cadence while auth-pending (cold-start 401
  // before token restores), then give up into a retryable error state.
  useEffect(() => {
    if (ctxEvent) return;
    const decision = nextRetryDecision(fallbackAuthRace);
    if (decision.action === "give-up") {
      setFallbackAuthRace(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void fetchFallbackEvent(true); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [fallbackAuthRace, ctxEvent, fetchFallbackEvent]);

  const retryFallbackEvent = useCallback(() => {
    setFallbackAuthRace(resetAuthRaceState());
    void fetchFallbackEvent(true);
  }, [fetchFallbackEvent]);

  const initialTab: EventTab =
    tabParam === "costs" ? "costs"
    : tabParam === "guests" ? "guests"
    : tabParam === "tasks" ? "tasks"
    : tabParam === "chat" ? "chat"
    : tabParam === "photos" ? "photos"
    : "overview";
  const [tab, setTab] = useState<EventTab>(initialTab);
  const { markEventChatRead } = useMessages();
  const lastMsgIso = event?.messages?.[event.messages.length - 1]?.createdAt;
  useEffect(() => {
    if (tab === "chat" && event) markEventChatRead(event.id, lastMsgIso);
  }, [tab, event?.id, lastMsgIso, markEventChatRead]);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMember, setContactMember] = useState<ResolvedUser | null>(null);
  // Which RSVP status is currently being submitted (null = idle). Used to
  // disable all three buttons and show a spinner on the tapped one while the
  // optimistic mutation is in flight.
  const [pendingRsvp, setPendingRsvp] = useState<RsvpStatus | null>(null);
  // T208: inline micro-moment after tapping "Going" — shows attendee avatars +
  // count so committing feels social. Session-only, dismissed by other RSVPs.
  const [showRsvpMoment, setShowRsvpMoment] = useState(false);
  // T205: vault photo count for the past-plan recap strip (null = not loaded).
  const [recapPhotoCount, setRecapPhotoCount] = useState<number | null>(null);
  const [showInvitePicker, setShowInvitePicker] = useState(false);
  const { resolveUser, prefetchUsers } = useUserCache();

  // Contextual cost-split coach mark: fires the first time the user opens an
  // event, anchored to the "Costs" tab (where splitting actually lives).
  const { eventCostActive, canShowEventCostTip, maybeShowEventCostTip, setEventCostAnchor } = useTips();
  const tabScrollRef = useRef<ScrollView>(null);
  const costsChipRef = useRef<View>(null);
  const costsChipX = useRef(0);

  // Surface the cost tip once the event has loaded and showing is actually
  // allowed. Keying on `canShowEventCostTip` means it re-attempts the moment the
  // gate opens — the seen flag finishes loading, the sequential tour ends, or the
  // fail-safe releases a stuck active flag — rather than being a one-shot miss.
  const eventLoaded = !!event;
  useEffect(() => {
    if (!eventLoaded || !canShowEventCostTip) return;
    const t = setTimeout(() => maybeShowEventCostTip(), 600);
    return () => clearTimeout(t);
  }, [eventLoaded, canShowEventCostTip, maybeShowEventCostTip]);

  // Once the cost tip is active, reveal the Costs chip and measure it so the
  // coach mark can point at it precisely.
  useEffect(() => {
    if (!eventCostActive) return;
    tabScrollRef.current?.scrollTo({ x: Math.max(0, costsChipX.current - 40), animated: true });
    const t = setTimeout(() => {
      costsChipRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 || height > 0) setEventCostAnchor({ x, y, width, height });
      });
    }, 380);
    return () => clearTimeout(t);
  }, [eventCostActive, setEventCostAnchor]);

  // Drop the anchor when leaving the event screen so the global coach mark
  // never flashes at this event's stale coordinates on the next screen.
  useEffect(() => {
    return () => setEventCostAnchor(null);
  }, [setEventCostAnchor]);

  // Pre-load all user profiles referenced in this event
  useEffect(() => {
    if (!event) return;
    const s = getSquad(event.squadId);
    const ids = [
      event.hostId,
      ...(s?.memberIds ?? []),
      ...Object.keys(event.rsvps),
      ...event.tasks.filter((t) => t.assigneeId).map((t) => t.assigneeId!),
      ...event.costs.map((c) => c.paidById),
      ...event.messages.map((m) => m.senderId),
    ];
    prefetchUsers(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);
  const [availabilityTitle, setAvailabilityTitle] = useState<string | null>(null);
  const [newResponseCount, setNewResponseCount] = useState(0);
  const [firstRsvpCelebration, setFirstRsvpCelebration] = useState(false);
  const [findTimeOpen, setFindTimeOpen] = useState(false);

  // B6: the host's first "going" RSVP (from anyone but themselves) is a moment —
  // celebrate it full-screen once per event.
  useEffect(() => {
    if (!event || !id) return;
    if (event.hostId !== currentUser.id) return;
    const goingOthers = Object.entries(event.rsvps).filter(
      ([uid, s]) => s === "going" && uid !== event.hostId,
    ).length;
    if (goingOthers < 1) return;
    void (async () => {
      if (await claimOnce(`firstrsvp_${id}`, currentUser.id)) {
        setFirstRsvpCelebration(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.rsvps, id, currentUser.id]);

  const authHeaders = useCallback((): HeadersInit => {
    return buildAuthHeaders(authToken);
  }, [authToken]);

  // T205: past plans get a recap strip (photos · attendance · costs). Photo
  // count comes from the vault; attendance/costs are already on the event.
  useEffect(() => {
    if (!event || !id) return;
    const start = parseEventStart(event.date);
    if (!start || start >= new Date()) return;
    fetch(`${API_BASE}/api/vault/photos?eventId=${id}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { photos?: unknown[] } | null) => {
        if (data && Array.isArray(data.photos)) setRecapPhotoCount(data.photos.length);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.date, id, authToken]);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let active = true;
      const avKey = `availability_lastviewed_${id}`;
      Promise.all([
        fetch(`${API_BASE}/api/availability/polls/find?eventId=${id}`, { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
        AsyncStorage.getItem(avKey).catch(() => null),
      ]).then(([d, stored]: [{ poll?: { title?: string; createdBy?: string }; members?: { id: string; respondedAt: string | null }[] } | null, string | null]) => {
        if (!active) return;
        setAvailabilityTitle(d?.poll?.title ?? null);
        if (d?.poll?.createdBy === currentUser.id && stored) {
          const lastViewedAt = new Date(Number(stored));
          const count = (d.members ?? []).filter((m) => {
            if (m.id === currentUser.id) return false;
            if (!m.respondedAt) return false;
            return new Date(m.respondedAt) > lastViewedAt;
          }).length;
          setNewResponseCount(count);
        } else {
          setNewResponseCount(0);
        }
      });
      return () => { active = false; };
    }, [id, authHeaders, currentUser.id])
  );

  // SSE stream: instantly refreshes event data (RSVPs, messages, tasks, costs,
  // polls) when any teammate mutates the event — no polling lag.
  useEventStream({
    eventId: id ?? null,
    authToken,
    onUpdate: useCallback(() => { void refreshEvents(); }, [refreshEvents]),
  });

  // 30 s safety-net poll: catches any updates missed when the stream is
  // temporarily unavailable (network blip, proxy timeout, etc.).
  useEffect(() => {
    const interval = setInterval(() => { void refreshEvents(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshEvents]);

  // Load payment handles when the Costs tab is opened, to power settle-up deep links.
  useEffect(() => {
    if (tab !== "costs" || !id) return;
    let active = true;
    void fetchPaymentHandles(id).then((h) => {
      if (active) setPaymentHandles(h);
    });
    return () => { active = false; };
  }, [tab, id, fetchPaymentHandles]);

  // Modals
  const [taskModal, setTaskModal] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [foodModal, setFoodModal] = useState(false);
  const [newFoodItem, setNewFoodItem] = useState("");

  const [costModal, setCostModal] = useState(false);
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  const [costDesc, setCostDesc] = useState("");
  const [costTotal, setCostTotal] = useState("");
  const [costShares, setCostShares] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<"even" | "manual">("even");
  const [taskSaving, setTaskSaving] = useState(false);
  const [costSaving, setCostSaving] = useState(false);
  const [pollSaving, setPollSaving] = useState(false);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [paymentHandles, setPaymentHandles] = useState<
    Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>
  >({});
  const [calBusy, setCalBusy] = useState(false);
  const [remBusy, setRemBusy] = useState(false);
  const [generalReminderBusy, setGeneralReminderBusy] = useState(false);
  const [rsvpReminderBusy, setRsvpReminderBusy] = useState(false);

  const [togglingTaskIds, setTogglingTaskIds] = useState<Set<string>>(new Set());
  const [claimingTaskIds, setClaimingTaskIds] = useState<Set<string>>(new Set());

  const handleToggleTask = useCallback(async (eventId: string, taskId: string) => {
    if (togglingTaskIds.has(taskId)) return;
    setTogglingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      await toggleTask(eventId, taskId);
    } finally {
      setTogglingTaskIds((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
    }
  }, [togglingTaskIds, toggleTask]);

  const handleClaimTask = useCallback(async (eventId: string, taskId: string) => {
    if (claimingTaskIds.has(taskId)) return;
    setClaimingTaskIds((prev) => new Set(prev).add(taskId));
    try {
      await claimTask(eventId, taskId);
    } finally {
      setClaimingTaskIds((prev) => { const next = new Set(prev); next.delete(taskId); return next; });
    }
  }, [claimingTaskIds, claimTask]);

  const [pollModal, setPollModal] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);

  const [editModal, setEditModal] = useState(false);
  const [edit, setEdit] = useState({ title: "", date: "", location: "", description: "", emoji: "🔥" });
  // Optional event end time (editable). null = explicitly none; seeded in openEdit.
  const [editEndAt, setEditEndAt] = useState<string | null>(null);
  const [endPickerDate, setEndPickerDate] = useState(new Date());
  const [endPickerStep, setEndPickerStep] = useState<"date" | "time" | null>(null);

  const [budgetModal, setBudgetModal] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");

  const [chatText, setChatText] = useState("");
  const [chatSending, setChatSending] = useState(false);

  const conflictBannerAnim = useRef(new Animated.Value(0)).current;
  const titleHighlightAnim = useRef(new Animated.Value(0)).current;
  const dateHighlightAnim = useRef(new Animated.Value(0)).current;
  const locationHighlightAnim = useRef(new Animated.Value(0)).current;
  const descHighlightAnim = useRef(new Animated.Value(0)).current;
  const tasksHighlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!id || conflictEventId !== id) return;
    clearConflictEvent();

    // Banner animation
    Animated.sequence([
      Animated.timing(conflictBannerAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.delay(2500),
      Animated.timing(conflictBannerAnim, { toValue: 0, duration: 350, useNativeDriver: false }),
    ]).start();

    if (!event) return;

    // Diff snapshot against the freshly-loaded event to find changed fields
    const fieldAnims: Animated.Value[] = [];
    if (conflictSnapshot && conflictSnapshot.eventId === id) {
      const s = conflictSnapshot;
      if (s.title !== event.title) fieldAnims.push(titleHighlightAnim);
      if (s.date !== event.date) fieldAnims.push(dateHighlightAnim);
      if (s.location !== event.location) fieldAnims.push(locationHighlightAnim);
      if (s.description !== event.description) fieldAnims.push(descHighlightAnim);
      if (JSON.stringify(s.tasks) !== JSON.stringify(event.tasks)) fieldAnims.push(tasksHighlightAnim);
    }
    // If snapshot is absent or nothing diffed, highlight all editable fields as a safe fallback
    const toAnimate = fieldAnims.length > 0
      ? fieldAnims
      : [titleHighlightAnim, dateHighlightAnim, locationHighlightAnim, descHighlightAnim, tasksHighlightAnim];

    toAnimate.forEach((anim) => {
      anim.setValue(0);
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: false }),
        Animated.delay(2000),
        Animated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: false }),
      ]).start();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictEventId, id]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);
  const btnTop = topPad + 8;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never));

  // Private cross-squad conflict check: computed only from this user's own
  // plans list, shown only to them, and never blocks the RSVP.
  // MUST be declared before the `if (!event)` early return below — a hook after
  // a conditional return violates the Rules of Hooks and crashes the screen
  // with a hook-order error the moment the event finishes loading.
  const myRsvpForConflicts = event ? (event.rsvps[currentUser.id] ?? null) : null;
  const myConflicts = useMemo(
    () =>
      event && (myRsvpForConflicts === "going" || myRsvpForConflicts === "maybe")
        ? findMyConflicts({
            candidate: getPlanSpan(event),
            plans: events,
            userId: currentUser.id,
            squads,
            excludeId: event.id,
          })
        : [],
    [myRsvpForConflicts, event, events, currentUser.id, squads],
  );

  if (!event) {
    // Two sources of loading/error truth:
    //  • Global (eventsLoading/eventsAuthPending/eventsAuthError): cold-start 401
    //    before context has loaded at all — applies to upcoming events.
    //  • Fallback (fallbackAuthRace): past events that aren't in the upcoming list
    //    and must be fetched individually. A freshly-mounted past-event screen will
    //    be spinning here while fetchFallbackEvent runs, even when global events
    //    have already settled — use the fallback race state in that case.
    const usingFallbackPath = !eventsLoading && !eventsAuthPending && !eventsAuthError;
    // For the fallback path, "loading" = waiting for the first fetch OR pending a
    // retry; INITIAL_AUTH_RACE_STATE has both flags false and tick 0, which means
    // the fetch hasn't landed yet — treat that as loading too.
    const fallbackLoading =
      fallbackAuthRace.authPending ||
      (!fallbackAuthRace.authError && fallbackAuthRace.tick === 0);
    const notFoundMode = usingFallbackPath
      ? vaultRenderMode({
          loading: fallbackLoading,
          authPending: fallbackAuthRace.authPending,
          authError: fallbackAuthRace.authError,
          photoCount: 0,
        })
      : vaultRenderMode({
          loading: eventsLoading,
          authPending: eventsAuthPending,
          authError: eventsAuthError,
          photoCount: 0,
        });
    const onRetry = usingFallbackPath ? retryFallbackEvent : retryEvents;
    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        {notFoundMode === "loading" ? (
          <View style={{ marginTop: 80, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : notFoundMode === "error" ? (
          <View style={{ marginTop: 80, alignItems: "center", gap: 10, paddingHorizontal: 32 }}>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.textDim} />
            <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "800" }}>Couldn't load this event</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 14, textAlign: "center" }}>
              Check your connection and try again.
            </Text>
            <TouchableOpacity
              onPress={onRetry}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.primary, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, marginTop: 4 }}
            >
              <Ionicons name="refresh-outline" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>Event not found</Text>
        )}
      </View>
    );
  }

  const isHost = event.hostId === currentUser.id;
  const eventCoAdminIds = event.coAdminIds ?? [];
  // "Help manage": host + co-admins can edit details. Only the host can cancel
  // the event or change who the co-admins are.
  const canManage = isHost || eventCoAdminIds.includes(currentUser.id);
  const squad = getSquad(event.squadId);

  // Manual reminder cooldown state (1 h, independent per type).
  const MANUAL_REMINDER_COOLDOWN_MS = 60 * 60 * 1000;
  const nowMs = Date.now();
  const generalLastSentMs = event.manualReminderGeneralSentAt
    ? new Date(event.manualReminderGeneralSentAt).getTime()
    : null;
  const rsvpLastSentMs = event.manualReminderRsvpSentAt
    ? new Date(event.manualReminderRsvpSentAt).getTime()
    : null;
  const generalOnCooldown = generalLastSentMs !== null && nowMs - generalLastSentMs < MANUAL_REMINDER_COOLDOWN_MS;
  const rsvpOnCooldown = rsvpLastSentMs !== null && nowMs - rsvpLastSentMs < MANUAL_REMINDER_COOLDOWN_MS;

  const handleManualReminder = async (type: "general" | "rsvp") => {
    if (type === "general" ? generalReminderBusy : rsvpReminderBusy) return;
    const setBusy = type === "general" ? setGeneralReminderBusy : setRsvpReminderBusy;
    setBusy(true);
    try {
      Haptics.selectionAsync();
      const result = await sendManualReminder(event.id, type, authToken);
      if (!result.ok) {
        if (result.status === 429 && result.retryAfterMs != null) {
          const minsLeft = Math.ceil(result.retryAfterMs / 60000);
          Alert.alert(
            "Reminder sent recently",
            `You can send another in about ${minsLeft} minute${minsLeft !== 1 ? "s" : ""}.`,
          );
        } else {
          Alert.alert("Couldn't send reminder", result.error ?? "Something went wrong.");
        }
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const label =
        type === "general"
          ? "Your guests have been reminded about this event."
          : "Guests who haven't responded yet have been nudged.";
      Alert.alert("Reminder sent", label);
      void refreshEvents();
    } catch {
      Alert.alert("Couldn't send reminder", "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  function resolveForDisplay(userId: string): ResolvedUser {
    if (userId === currentUser.id) {
      return {
        ...(currentUser as unknown as ResolvedUser),
        isPro: resolveUser(currentUser.id).isPro,
      };
    }
    return resolveUser(userId);
  }

  const host = resolveForDisplay(event.hostId);
  const squadMembers = squad ? squad.memberIds.map((mid) => resolveForDisplay(mid)) : [resolveForDisplay(currentUser.id)];
  const squadName = squad?.name ?? event.squadName;
  const myRsvp = event.rsvps[currentUser.id] ?? null;

  // All RSVP'd users (includes invite-link joiners who aren't squad members)
  const costParticipants = Object.keys(event.rsvps).map((uid) => resolveUser(uid));

  const spent = event.costs.reduce((s, c) => s + c.amount, 0);
  const hasBudget = event.budget != null;
  const budgetVal = event.budget ?? 0;
  const budgetRemaining = budgetVal - spent;
  const budgetPct = budgetVal > 0 ? Math.min(100, (spent / budgetVal) * 100) : 0;
  const budgetPerPerson = budgetVal / Math.max(1, costParticipants.length);
  const budgetOver = budgetRemaining < 0;

  const attendees = Object.entries(event.rsvps).map(([uid, status]) => ({
    user: resolveForDisplay(uid),
    status,
  }));

  // Friends invited directly who haven't responded yet (RSVP'd invitees already
  // appear in `attendees`). Shown as a "pending" group so the host can see who
  // still owes a reply.
  const invitedPending = (event.invitedUserIds ?? [])
    .filter((uid) => !(uid in event.rsvps))
    .map((uid) => resolveForDisplay(uid));
  // Anyone with access can invite (matches the backend, which gates invites on
  // getEventAsMember): host, an RSVP'd guest, or a directly-invited friend.
  const canInvite =
    event.hostId === currentUser.id ||
    currentUser.id in event.rsvps ||
    (event.invitedUserIds ?? []).includes(currentUser.id);

  // Co-admins: people with event access (squad members + RSVP'd + invited),
  // minus the host and anyone already a co-admin, can be promoted.
  const coAdmins = eventCoAdminIds.map((uid) => resolveForDisplay(uid));
  const coAdminCandidates = [
    ...new Set([
      ...(squad?.memberIds ?? []),
      ...Object.keys(event.rsvps),
      ...(event.invitedUserIds ?? []),
    ]),
  ]
    .filter((uid) => uid !== event.hostId && !eventCoAdminIds.includes(uid))
    .map((uid) => resolveForDisplay(uid));

  const statusColor = (s: RsvpStatus) =>
    s === "going" ? colors.green : s === "maybe" ? colors.gold : colors.destructive;

  const handleAddToCalendar = async () => {
    if (calBusy) return;
    const ics = buildPlanIcs(event);
    if (!ics) {
      Alert.alert("Can't add to calendar", "This event doesn't have a clear date yet.");
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

  const handleRemindRsvp = async () => {
    if (remBusy) return;
    const start = parseEventStart(event.date);
    if (!start) {
      Alert.alert("Can't set a reminder", "This event doesn't have a clear date yet.");
      return;
    }
    setRemBusy(true);
    try {
      const res = await scheduleRsvpReminder({ title: event.title, start });
      if (res.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert("Reminder set", res.whenLabel ? `We'll nudge you on ${res.whenLabel}.` : "We'll remind you to RSVP.");
      } else {
        Alert.alert("No reminder set", res.message ?? "Please try again.");
      }
    } catch {
      Alert.alert("No reminder set", "Something went wrong. Please try again.");
    } finally {
      setRemBusy(false);
    }
  };

  const TABS: { key: EventTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "guests", label: "Guests" },
    { key: "tasks", label: "Tasks" },
    { key: "food", label: "🍕 Food" },
    { key: "costs", label: "Costs" },
    { key: "chat", label: "Chat" },
    { key: "photos", label: "📷 Vault" },
    ...(canManage ? [{ key: "admin" as EventTab, label: "Admin" }] : []),
  ];

  // ---- Cost modal helpers ----
  const openCostModal = () => {
    setEditingCostId(null);
    setCostDesc("");
    setCostTotal("");
    setCostShares({});
    setSplitMode("even");
    setSelectedParticipantIds(new Set(Object.keys(event.rsvps)));
    setCostModal(true);
  };

  // Edit an existing expense (payer or host only — mirrors the trip screen's
  // shared costs panel). Prefills the modal in manual mode with the cost's
  // current shares; departed users drop out of the editable selection.
  const openEditCostModal = (cost: SquadzEvent["costs"][number]) => {
    setEditingCostId(cost.id);
    setCostDesc(cost.description);
    setCostTotal(String(cost.amount));
    const shareMap: Record<string, string> = {};
    cost.shares.forEach((s) => { shareMap[s.userId] = String(s.amount); });
    setCostShares(shareMap);
    setSplitMode("manual");
    const editableIds = new Set(costParticipants.map((p) => p.id));
    setSelectedParticipantIds(
      new Set(cost.shares.map((s) => s.userId).filter((uid) => editableIds.has(uid))),
    );
    setCostModal(true);
  };

  const confirmDeleteCost = (cost: SquadzEvent["costs"][number]) => {
    Alert.alert(
      "Delete this cost? Balances for everyone in this split will update.",
      undefined,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const result = await deleteCost(event.id, cost.id, event.version);
            if (result.error) {
              Alert.alert(result.conflict ? "Cost changed" : "Couldn't delete expense", result.error);
              return;
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ],
    );
  };

  const totalNum = parseFloat(costTotal) || 0;

  // Only include participants that the user has selected for this split
  const splitParticipants = costParticipants.filter((m) => selectedParticipantIds.has(m.id));

  const toggleSplitParticipant = (uid: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) {
        next.delete(uid);
      } else {
        next.add(uid);
      }
      return next;
    });
  };

  // Compute even-split shares inline so they stay in sync with the total
  const evenShares: Record<string, string> = {};
  if (totalNum > 0 && splitParticipants.length > 0) {
    const per = Math.floor((totalNum / splitParticipants.length) * 100) / 100;
    let running = 0;
    splitParticipants.forEach((m, i) => {
      if (i === splitParticipants.length - 1) {
        evenShares[m.id] = (Math.round((totalNum - running) * 100) / 100).toFixed(2);
      } else {
        evenShares[m.id] = per.toFixed(2);
        running += per;
      }
    });
  }

  const activeShares = splitMode === "even" ? evenShares : costShares;
  const shareValues = splitParticipants.map((m) => parseFloat(activeShares[m.id] || "0") || 0);
  const hasNegative = shareValues.some((v) => v < 0);
  const assignedNum = shareValues.reduce((sum, v) => sum + v, 0);
  const remaining = totalNum - assignedNum;
  const covered = totalNum > 0 && splitParticipants.length > 0 && !hasNegative && Math.abs(remaining) < 0.01;

  const switchToManual = () => {
    // Copy current even-split values so the user has a good starting point
    setCostShares({ ...evenShares });
    setSplitMode("manual");
  };

  const saveCost = async () => {
    if (costSaving) return;
    if (!costDesc.trim()) {
      Alert.alert("Missing info", "Add a description for the expense.");
      return;
    }
    if (totalNum <= 0) {
      Alert.alert("Missing amount", "Enter a total greater than $0.");
      return;
    }
    if (splitParticipants.length === 0) {
      Alert.alert("No one selected", "Select at least one person to split the cost with.");
      return;
    }
    if (hasNegative) {
      Alert.alert("Invalid amount", "Shares can't be negative. Enter $0 or more for each person.");
      return;
    }
    if (!covered) {
      Alert.alert("Bill not covered", `Assign the full $${totalNum.toFixed(2)} across people. $${remaining.toFixed(2)} left.`);
      return;
    }
    const shares = splitParticipants
      .map((m) => ({ userId: m.id, amount: parseFloat(activeShares[m.id] || "0") || 0 }))
      .filter((s) => s.amount > 0);
    setCostSaving(true);
    try {
      const payload = { description: costDesc.trim(), amount: totalNum, shares };
      const result = editingCostId
        ? await updateCost(event.id, editingCostId, payload, event.version)
        : await addCost(event.id, payload);
      if (result.error) {
        Alert.alert(
          "conflict" in result && result.conflict ? "Cost changed" : "Couldn't save expense",
          result.error,
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCostModal(false);
    } finally {
      setCostSaving(false);
    }
  };

  // ---- Task modal ----
  const saveTask = async () => {
    if (taskSaving || !newTask.trim()) return;
    setTaskSaving(true);
    try {
      const result = await addTask(event.id, newTask.trim());
      if (result.error) {
        Alert.alert("Couldn't save task", result.error);
        return;
      }
      setNewTask("");
      setTaskModal(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } finally {
      setTaskSaving(false);
    }
  };

  const saveFoodItem = async () => {
    if (!newFoodItem.trim()) return;
    const result = await addTask(event.id, newFoodItem.trim(), "food");
    if (result.error) {
      Alert.alert("Couldn't add food item", result.error);
      return;
    }
    setNewFoodItem("");
    setFoodModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ---- Poll modal ----
  const savePoll = async () => {
    if (pollSaving) return;
    const opts = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!pollQ.trim() || opts.length < 2) {
      Alert.alert("Incomplete poll", "Add a question and at least 2 options.");
      return;
    }
    setPollSaving(true);
    try {
      const result = await addPoll(event.id, pollQ.trim(), opts);
      if (result.error) {
        Alert.alert("Couldn't save poll", result.error);
        return;
      }
      setPollQ("");
      setPollOpts(["", ""]);
      setPollModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } finally {
      setPollSaving(false);
    }
  };

  // ---- Edit modal ----
  const openEdit = () => {
    setEdit({
      title: event.title,
      date: event.date,
      location: event.location,
      description: event.description,
      emoji: event.emoji,
    });
    setEditEndAt(event.endAt ?? null);
    setEditModal(true);
  };
  const eventStart = event?.startAt
    ? new Date(event.startAt)
    : event?.eventAt
      ? new Date(event.eventAt)
      : parseEventStart(event?.date ?? "");
  const isCancelled = !!event.cancelled;
  const isPastEvent = eventStart != null && eventStart.getTime() < Date.now();
  const saveEdit = () => {
    if (!edit.title.trim()) {
      Alert.alert("Missing info", "Event needs a title.");
      return;
    }
    if (editEndAt && eventStart && new Date(editEndAt).getTime() < eventStart.getTime()) {
      Alert.alert("Check the end time", "The end time can't be before the event starts.");
      return;
    }
    updateEvent(event.id, {
      title: edit.title.trim(),
      date: edit.date.trim(),
      location: edit.location.trim(),
      description: edit.description.trim(),
      emoji: edit.emoji,
      // null clears the end time; a string sets it.
      endAt: editEndAt,
    });
    setEditModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openEndPicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEndPickerDate(editEndAt ? new Date(editEndAt) : eventStart ?? new Date());
    setEndPickerStep("date");
  };
  const handleEndIOSConfirm = () => {
    if (endPickerStep === "date") {
      setEndPickerStep("time");
    } else {
      setEditEndAt(endPickerDate.toISOString());
      setEndPickerStep(null);
    }
  };
  const handleEndAndroidChange = (_: DateTimePickerEvent, d?: Date) => {
    if (!d) { setEndPickerStep(null); return; }
    const updated = new Date(endPickerDate);
    if (endPickerStep === "date") {
      updated.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
      setEndPickerDate(updated);
      setTimeout(() => setEndPickerStep("time"), 50);
    } else {
      updated.setHours(d.getHours(), d.getMinutes());
      setEndPickerDate(updated);
      setEditEndAt(updated.toISOString());
      setEndPickerStep(null);
    }
  };

  const confirmCancel = () => {
    Alert.alert("Cancel event", `Cancel "${event.title}"? This can't be undone.`, [
      { text: "Keep event", style: "cancel" },
      {
        text: "Cancel event",
        style: "destructive",
        onPress: () => {
          cancelEvent(event.id);
          goBack();
        },
      },
    ]);
  };

  const openBudget = () => {
    setBudgetInput(event.budget != null ? String(event.budget) : "");
    setBudgetModal(true);
  };
  const saveBudget = () => {
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) {
      Alert.alert("Invalid budget", "Enter a budget of $0 or more.");
      return;
    }
    updateEvent(event.id, { budget: val });
    setBudgetModal(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const clearBudget = () => {
    updateEvent(event.id, { budget: undefined });
    setBudgetModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* Hero */}
      <View style={[styles.hero, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={goBack} style={[styles.backBtn, { top: btnTop }]}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Share.share({ message: `Join ${event.title}! Code: ${event.inviteCode}` })}
          style={[styles.shareBtn, { top: btnTop }]}
        >
          <Ionicons name="share-outline" size={22} color="#fff" />
        </TouchableOpacity>
        {canManage && (
          <TouchableOpacity onPress={openEdit} style={[styles.gearBtn, { top: btnTop }]}>
            <Ionicons name="settings-outline" size={21} color="#fff" />
          </TouchableOpacity>
        )}
        <Text style={styles.heroEmoji}>{event.emoji}</Text>
        <Animated.View
          style={[
            styles.heroTitleRow,
            {
              backgroundColor: titleHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
              borderRadius: 10,
              paddingHorizontal: 6,
              paddingVertical: 2,
            },
          ]}
        >
          <Text style={styles.heroTitle}>{event.title}</Text>
          {isHost && (
            <View style={styles.heroHostBadge}>
              <Ionicons name="star" size={11} color="#fff" />
              <Text style={styles.heroHostText}>You're hosting</Text>
            </View>
          )}
        </Animated.View>
        <Animated.View
          style={{
            backgroundColor: dateHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
            borderRadius: 8,
            paddingHorizontal: 6,
            alignSelf: "center",
          }}
        >
          <Text style={styles.heroDate}>{event.date}</Text>
        </Animated.View>
        {event.endAt ? (
          <Text style={styles.heroDate}>Ends {formatEndLabel(event.endAt)}</Text>
        ) : null}
        <Animated.View
          style={{
            backgroundColor: locationHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
            borderRadius: 8,
            paddingHorizontal: 6,
            marginBottom: 14,
            alignSelf: "center",
          }}
        >
          <AddressLink
            location={event.location}
            textStyle={[styles.heroLocation, { marginBottom: 0 }]}
            iconColor="rgba(255,255,255,0.85)"
          />
        </Animated.View>

        {(() => {
          const start = parseEventStart(event.date ?? "");
          const cd = start ? formatCountdown(start, nowTick) : null;
          if (!cd) return null;
          return (
            <View
              accessible
              accessibilityRole="text"
              accessibilityLabel={`Event ${cd.label}`}
              accessibilityLiveRegion="polite"
              style={[
                styles.countdownPill,
                { backgroundColor: cd.soon ? "rgba(255,92,58,0.22)" : "rgba(255,255,255,0.14)" },
              ]}
            >
              <Ionicons
                name={cd.soon ? "flame" : "time-outline"}
                size={13}
                color={cd.soon ? colors.primary : "#fff"}
              />
              <Text style={[styles.countdownText, cd.soon && { color: colors.primary }]}>
                {cd.label}
              </Text>
            </View>
          );
        })()}

        {/* Cancelled banner */}
        {isCancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="close-circle" size={15} color="#fff" />
            <Text style={styles.cancelledBannerText}>This event was cancelled</Text>
          </View>
        )}

        {/* RSVP buttons — hidden when the event is cancelled or already happened */}
        {!isCancelled && !isPastEvent && (
        <View style={styles.rsvpRow}>
          {(["going", "maybe", "notgoing"] as RsvpStatus[]).map((v) => {
            const rsvpBusy = pendingRsvp !== null;
            return (
              <TouchableOpacity
                key={v}
                disabled={rsvpBusy}
                onPress={() => {
                  if (pendingRsvp !== null) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  setPendingRsvp(v);
                  setRsvp(event.id, v);
                  if (v === "going") {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setShowRsvpMoment(true);
                  } else {
                    setShowRsvpMoment(false);
                  }
                  setTimeout(() => setPendingRsvp(null), 600);
                }}
                style={[
                  styles.rsvpBtn,
                  {
                    backgroundColor: myRsvp === v ? statusColor(v) : "rgba(255,255,255,0.15)",
                    borderColor: myRsvp === v ? "transparent" : "rgba(255,255,255,0.3)",
                    opacity: rsvpBusy && pendingRsvp !== v ? 0.5 : 1,
                  },
                ]}
              >
                {pendingRsvp === v ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons
                    name={v === "going" ? "checkmark" : v === "maybe" ? "help" : "close"}
                    size={15}
                    color="#fff"
                  />
                )}
                <Text style={styles.rsvpText}>{STATUS_LABEL[v]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        )}

        {showRsvpMoment && myRsvp === "going" && (() => {
          const going = Object.entries(event.rsvps)
            .filter(([, s]) => s === "going")
            .map(([uid]) => resolveUser(uid));
          const count = going.length;
          return (
            <View style={styles.rsvpMoment}>
              <View style={styles.rsvpMomentAvatars}>
                {going.slice(0, 5).map((u, i) => (
                  <View key={u.id} style={{ marginLeft: i === 0 ? 0 : -8 }}>
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={24} fontSize={9} />
                  </View>
                ))}
              </View>
              <Text style={styles.rsvpMomentText}>
                You're in — {count} going 🎉
              </Text>
            </View>
          );
        })()}
      </View>

      {/* Tab bar */}
      <ScrollView
        ref={tabScrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 4 }}
      >
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            ref={t.key === "costs" ? (costsChipRef as never) : undefined}
            onLayout={
              t.key === "costs"
                ? (e) => { costsChipX.current = e.nativeEvent.layout.x; }
                : undefined
            }
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t.key); }}
            style={[
              styles.tabChip,
              {
                backgroundColor: tab === t.key ? colors.primary : "transparent",
                borderColor: tab === t.key ? colors.primary : "transparent",
              },
            ]}
          >
            <Text style={[styles.tabChipText, { color: tab === t.key ? "#fff" : colors.mutedForeground }]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Conflict refresh banner */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.conflictBanner,
          {
            height: conflictBannerAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 40] }),
            opacity: conflictBannerAnim,
          },
        ]}
      >
        <Text style={styles.conflictBannerText}>↻ Refreshed — showing latest version</Text>
      </Animated.View>

      {/* Tab content */}
      <ScrollView
        style={styles.tabContent}
        contentContainerStyle={{ padding: 20, paddingBottom: botPad + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "overview" && (
          <View style={{ gap: 16 }}>
            {(() => {
              const start = parseEventStart(event.date);
              if (!start || start >= new Date()) return null;
              const went = goingCount(event);
              const total = event.costs.reduce((s, c) => s + c.amount, 0);
              const parts: { icon: string; label: string }[] = [];
              if (recapPhotoCount !== null && recapPhotoCount > 0) {
                parts.push({ icon: "images-outline", label: `${recapPhotoCount} photo${recapPhotoCount === 1 ? "" : "s"}` });
              }
              parts.push({ icon: "people-outline", label: `${went} went` });
              if (total > 0) parts.push({ icon: "card-outline", label: `$${total.toFixed(2)} split` });
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
            <Animated.View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: descHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, "#F59E0B"] }),
                },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>About</Text>
              <Text style={[styles.cardBody, { color: event.description ? colors.foreground : colors.textDim }]}>
                {event.description || "No description yet."}
              </Text>
            </Animated.View>

            {/* Find the best time */}
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setFindTimeOpen(true);
              }}
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 12 }]}
            >
              <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "20" }}>
                <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>{availabilityTitle ?? "Find the Best Time"}</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Poll everyone & lock in when most can make it</Text>
              </View>
              {newResponseCount > 0 && (
                <View style={[styles.responseBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.responseBadgeText}>{newResponseCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>

            {myConflicts.length > 0 && (
              <ConflictBanner conflicts={myConflicts} style={{ marginBottom: 12 }} />
            )}

            {/* Add to calendar + RSVP reminder */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
              <TouchableOpacity
                onPress={handleAddToCalendar}
                disabled={calBusy}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: calBusy ? 0.6 : 1 }}
              >
                <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary + "20" }}>
                  {calBusy ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>Add to Calendar</Text>
                  <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Download a calendar file for this event</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </TouchableOpacity>

              {myRsvp == null && !isCancelled && !isPastEvent && (
                <>
                  <View style={{ height: 1, backgroundColor: colors.border }} />
                  <TouchableOpacity
                    onPress={handleRemindRsvp}
                    disabled={remBusy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: remBusy ? 0.6 : 1 }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.gold + "20" }}>
                      {remBusy ? (
                        <ActivityIndicator size="small" color={colors.gold} />
                      ) : (
                        <Ionicons name="notifications-outline" size={18} color={colors.gold} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>Remind me to RSVP</Text>
                      <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Get a nudge before it starts</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Polls */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Polls</Text>
                {!isCancelled && (
                  <TouchableOpacity onPress={() => setPollModal(true)} style={styles.inlineAdd}>
                    <Ionicons name="add" size={16} color={colors.primary} />
                    <Text style={[styles.inlineAddText, { color: colors.primary }]}>New poll</Text>
                  </TouchableOpacity>
                )}
              </View>
              {event.polls.length === 0 ? (
                <Text style={[styles.cardBody, { color: colors.textDim }]}>No polls yet. Start one to decide together.</Text>
              ) : (
                event.polls.map((poll) => {
                  const totalVotes = poll.options.reduce((s, o) => s + o.voterIds.length, 0);
                  const pollClosed = !!poll.closed;
                  const votingDisabled = pollClosed || isCancelled;
                  return (
                    <View key={poll.id} style={{ gap: 8, marginTop: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={[styles.pollQ, { color: colors.foreground, flex: 1 }]}>{poll.question}</Text>
                        {pollClosed && (
                          <View style={[styles.pollClosedBadge, { backgroundColor: colors.border }]}>
                            <Ionicons name="lock-closed" size={11} color={colors.mutedForeground} />
                            <Text style={[styles.pollClosedText, { color: colors.mutedForeground }]}>Closed</Text>
                          </View>
                        )}
                      </View>
                      {poll.options.map((o) => {
                        const pct = totalVotes ? Math.round((o.voterIds.length / totalVotes) * 100) : 0;
                        const voted = o.voterIds.includes(currentUser.id);
                        return (
                          <TouchableOpacity
                            key={o.id}
                            disabled={votingDisabled}
                            onPress={() => {
                              if (votingDisabled) return;
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              votePoll(event.id, poll.id, o.id);
                            }}
                            style={[styles.pollOpt, { borderColor: voted ? colors.primary : colors.border, opacity: pollClosed ? 0.75 : 1 }]}
                          >
                            <View style={[styles.pollFill, { width: `${pct}%`, backgroundColor: colors.primary + "22" }]} />
                            <View style={styles.pollOptRow}>
                              <Ionicons
                                name={voted ? "radio-button-on" : "radio-button-off"}
                                size={16}
                                color={voted ? colors.primary : colors.textDim}
                              />
                              <Text style={[styles.pollOptLabel, { color: colors.foreground }]}>{o.label}</Text>
                              <Text style={[styles.pollPct, { color: colors.mutedForeground }]}>{pct}%</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={[styles.pollMeta, { color: colors.textDim }]}>
                          {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
                        </Text>
                        {canManage && !isCancelled && (
                          <TouchableOpacity
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              setPollClosed(event.id, poll.id, !pollClosed);
                            }}
                          >
                            <Text style={[styles.pollMeta, { color: colors.primary, fontWeight: "700" }]}>
                              {pollClosed ? "Reopen poll" : "Close poll"}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Host</Text>
              <View style={styles.hostRow}>
                <UserAvatar initials={host.initials} color={host.color} imageUrl={host.profileImageUrl} size={40} fontSize={14} />
                <Text style={[styles.hostName, { color: colors.foreground }]}>{host.name}{isHost ? " (You)" : ""}</Text>
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Squad</Text>
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{squadName}</Text>
            </View>

            {/* Invite code — visible to all members */}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite friends</Text>
              <Text style={[styles.inviteCode, { color: colors.primary, marginBottom: 4 }]}>{event.inviteCode}</Text>
              <Text style={[styles.inviteLink, { color: colors.mutedForeground, marginBottom: 12 }]}>
                joinsquadz.com/join/{event.inviteCode}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Share.share({ message: `Join ${event.title}! https://joinsquadz.com/join/${event.inviteCode}` });
                }}
                style={[styles.shareInviteBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share invite link</Text>
              </TouchableOpacity>
            </View>

            {isHost && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="globe-outline" size={20} color={colors.foreground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitle, { color: colors.foreground, textTransform: "none" }]}>Public event</Text>
                    <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                      {event.isPublic
                        ? "Visible on Discover — friends can join directly"
                        : "Only joinable via invite code"}
                    </Text>
                  </View>
                  <Switch
                    value={event.isPublic ?? false}
                    onValueChange={(v) => { updateEvent(event.id, { isPublic: v }); }}
                    trackColor={{ false: colors.border, true: colors.primary + "80" }}
                    thumbColor={event.isPublic ? colors.primary : colors.mutedForeground}
                  />
                </View>
              </View>
            )}
          </View>
        )}

        {tab === "guests" && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {goingCount(event)} going · {attendees.length} responded
            </Text>
            {canInvite && (
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowInvitePicker(true); }}
                style={[styles.inviteFriendsRow, { borderColor: colors.primary + "50" }]}
                activeOpacity={0.8}
              >
                <Ionicons name="person-add-outline" size={20} color={colors.primary} />
                <Text style={[styles.inviteFriendsText, { color: colors.primary }]}>Invite friends</Text>
              </TouchableOpacity>
            )}
            {attendees.map(({ user: u, status }) => (
              <TouchableOpacity
                key={u.id}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.selectionAsync();
                  setContactMember(u);
                  setContactOpen(true);
                }}
                style={[styles.guestRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <ProAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={44} fontSize={15} isPro={u.isPro} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.guestName, { color: colors.foreground }]}>{u.name}{u.id === currentUser.id ? " (You)" : ""}</Text>
                  <Text style={[styles.guestStatus, { color: statusColor(status) }]}>{STATUS_LABEL[status]}</Text>
                </View>
                {u.id === event.hostId && (
                  <View style={[styles.hostBadge, { backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
                    <Text style={[styles.hostBadgeText, { color: colors.gold }]}>Host</Text>
                  </View>
                )}
                {u.id !== currentUser.id && (
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                )}
              </TouchableOpacity>
            ))}
            {invitedPending.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 6 }]}>
                  Invited · {invitedPending.length} pending
                </Text>
                {invitedPending.map((u) => {
                  const canRemove = event.hostId === currentUser.id || u.id === currentUser.id;
                  return (
                    <View
                      key={u.id}
                      style={[styles.guestRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <ProAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={44} fontSize={15} isPro={u.isPro} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.guestName, { color: colors.foreground }]}>{u.name}{u.id === currentUser.id ? " (You)" : ""}</Text>
                        <Text style={[styles.guestStatus, { color: colors.mutedForeground }]}>Invited — no reply yet</Text>
                      </View>
                      {canRemove && (
                        <TouchableOpacity
                          onPress={() => {
                            Haptics.selectionAsync();
                            void uninviteFromEvent(event.id, u.id).then((r) => {
                              if (r.error) Alert.alert("Couldn't remove", r.error);
                            });
                          }}
                          hitSlop={8}
                        >
                          <Ionicons name="close-circle-outline" size={22} color={colors.mutedForeground} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {tab === "tasks" && (
          <Animated.View
            style={{
              gap: 8,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: tasksHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.8)"] }),
              padding: 2,
            }}
          >
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {event.tasks.filter((t) => t.done).length}/{event.tasks.length} complete
            </Text>
            {event.tasks.map((task) => {
              const assignee = task.assigneeId ? resolveForDisplay(task.assigneeId) : null;
              const toggling = togglingTaskIds.has(task.id);
              const claiming = claimingTaskIds.has(task.id);
              return (
                <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: toggling ? 0.6 : 1 }]}>
                  <TouchableOpacity
                    disabled={toggling}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleToggleTask(event.id, task.id); }}
                  >
                    {toggling ? (
                      <ActivityIndicator size={24} color={colors.primary} />
                    ) : (
                      <Ionicons
                        name={task.done ? "checkmark-circle" : "ellipse-outline"}
                        size={24}
                        color={task.done ? colors.green : colors.border}
                      />
                    )}
                  </TouchableOpacity>
                  <Text style={[styles.taskText, { color: task.done ? colors.mutedForeground : colors.foreground, textDecorationLine: task.done ? "line-through" : "none" }]}>
                    {task.title}
                  </Text>
                  {assignee ? (
                    <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                  ) : (
                    <TouchableOpacity
                      disabled={claiming}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleClaimTask(event.id, task.id); }}
                      style={[styles.claimBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40", opacity: claiming ? 0.6 : 1 }]}
                    >
                      {claiming ? (
                        <ActivityIndicator size={12} color={colors.primary} />
                      ) : (
                        <Text style={[styles.claimText, { color: colors.primary }]}>Claim</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {!isCancelled && (
              <TouchableOpacity
                onPress={() => setTaskModal(true)}
                style={[styles.addRow, { borderColor: colors.border }]}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text style={[styles.addText, { color: colors.primary }]}>Add task</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {tab === "food" && (
          <View style={{ gap: 8 }}>
            {(() => {
              const foodItems = event.tasks.filter((t) => (t as { category?: string }).category === "food");
              const claimedCount = foodItems.filter((t) => t.assigneeId ?? t.done).length;
              return (
                <>
                  {foodItems.length > 0 && (
                    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                      {claimedCount}/{foodItems.length} claimed
                    </Text>
                  )}
                  {foodItems.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Text style={{ fontSize: 36, marginBottom: 8 }}>🍕</Text>
                      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No food list yet</Text>
                      <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add dishes and let people claim what they're bringing</Text>
                    </View>
                  ) : (
                    foodItems.map((task) => {
                      const assignee = task.assigneeId ? resolveForDisplay(task.assigneeId) : null;
                      const toggling = togglingTaskIds.has(task.id);
                      const claiming = claimingTaskIds.has(task.id);
                      return (
                        <View key={task.id} style={[styles.taskRow, { backgroundColor: colors.card, borderColor: colors.border, opacity: toggling ? 0.6 : 1 }]}>
                          <TouchableOpacity
                            disabled={toggling}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleToggleTask(event.id, task.id); }}
                          >
                            {toggling ? (
                              <ActivityIndicator size={24} color={colors.primary} />
                            ) : (
                              <Ionicons
                                name={task.done ? "checkmark-circle" : "ellipse-outline"}
                                size={24}
                                color={task.done ? colors.green : colors.border}
                              />
                            )}
                          </TouchableOpacity>
                          <Text style={[styles.taskText, { color: task.done ? colors.mutedForeground : colors.foreground, textDecorationLine: task.done ? "line-through" : "none" }]}>
                            {task.title}
                          </Text>
                          {assignee ? (
                            <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                          ) : (
                            <TouchableOpacity
                              disabled={claiming}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handleClaimTask(event.id, task.id); }}
                              style={[styles.claimBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40", opacity: claiming ? 0.6 : 1 }]}
                            >
                              {claiming ? (
                                <ActivityIndicator size={12} color={colors.primary} />
                              ) : (
                                <Text style={[styles.claimText, { color: colors.primary }]}>I'll bring it</Text>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })
                  )}
                  {!isCancelled && (
                    <TouchableOpacity
                      onPress={() => setFoodModal(true)}
                      style={[styles.addRow, { borderColor: colors.border }]}
                    >
                      <Ionicons name="add" size={20} color={colors.primary} />
                      <Text style={[styles.addText, { color: colors.primary }]}>Add food item</Text>
                    </TouchableOpacity>
                  )}
                </>
              );
            })()}
          </View>
        )}

        {tab === "costs" && (
          <View style={{ gap: 8 }}>
            {hasBudget ? (
              <View style={[styles.budgetCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.budgetHead}>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Group budget</Text>
                  {isHost && (
                    <TouchableOpacity onPress={openBudget} style={styles.budgetEdit}>
                      <Ionicons name="create-outline" size={15} color={colors.primary} />
                      <Text style={[styles.budgetEditText, { color: colors.primary }]}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={[styles.budgetAmount, { color: colors.foreground }]}>${budgetVal.toFixed(2)}</Text>
                <View style={[styles.budgetTrack, { backgroundColor: colors.surfaceUp }]}>
                  <View style={[styles.budgetFill, { width: `${budgetPct}%`, backgroundColor: budgetOver ? colors.destructive : colors.green }]} />
                </View>
                <View style={styles.budgetMetaRow}>
                  <Text style={[styles.budgetMeta, { color: colors.mutedForeground }]}>${spent.toFixed(2)} spent</Text>
                  <Text style={[styles.budgetMeta, { color: budgetOver ? colors.destructive : colors.green }]}>
                    {budgetOver ? `$${Math.abs(budgetRemaining).toFixed(2)} over` : `$${budgetRemaining.toFixed(2)} left`}
                  </Text>
                </View>
                <Text style={[styles.budgetPer, { color: colors.textDim }]}>≈ ${budgetPerPerson.toFixed(2)} per person</Text>
              </View>
            ) : isHost ? (
              <TouchableOpacity onPress={openBudget} style={[styles.addRow, { borderColor: colors.border }]}>
                <Ionicons name="wallet-outline" size={20} color={colors.primary} />
                <Text style={[styles.addText, { color: colors.primary }]}>Set group budget</Text>
              </TouchableOpacity>
            ) : null}
            {event.costs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="card-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No expenses yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Add a bill and split it with your squad</Text>
              </View>
            ) : (
              <>
                <View style={[styles.totalsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View>
                    <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Total spent</Text>
                    <Text style={[styles.totalsValue, { color: colors.foreground }]}>
                      ${event.costs.reduce((s, c) => s + c.amount, 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Your share</Text>
                    <Text style={[styles.totalsValue, { color: colors.primary }]}>
                      ${event.costs.reduce((s, c) => s + (c.shares.find((sh) => sh.userId === currentUser.id)?.amount ?? 0), 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
                <SettleUp
                  costs={event.costs}
                  meId={currentUser.id}
                  eventTitle={event.title}
                  colors={colors}
                  handles={{
                    ...paymentHandles,
                    [currentUser.id]: {
                      venmo: ownPaymentHandles.venmo,
                      cashapp: ownPaymentHandles.cashapp,
                      zelle: ownPaymentHandles.zelle,
                    },
                  }}
                  resolveUser={resolveForDisplay}
                  memberIds={new Set([
                    event.hostId,
                    currentUser.id,
                    ...(squad?.memberIds ?? []),
                    ...Object.keys(event.rsvps),
                    ...(event.invitedUserIds ?? []),
                  ])}
                  onMarkPaid={(costId, paid) => markSharePaid(event.id, costId, paid)}
                  onConfirm={(costId, debtorId, confirmed) => confirmShare(event.id, costId, debtorId, confirmed)}
                />
                {event.costs.map((cost) => {
                  const payer = resolveForDisplay(cost.paidById);
                  const myShare = cost.shares.find((s) => s.userId === currentUser.id)?.amount ?? 0;
                  const shareIds = cost.shares.map((s) => s.userId);
                  const goingIds = Object.entries(event.rsvps)
                    .filter(([, status]) => status === "going")
                    .map(([uid]) => uid);
                  const isAllGuests =
                    goingIds.length > 0 &&
                    goingIds.length === shareIds.length &&
                    goingIds.every((uid) => shareIds.includes(uid));
                  const participantLabel = isAllGuests
                    ? "All guests"
                    : shareIds
                        .map((uid) => {
                          if (uid === currentUser.id) return "you";
                          const u = resolveForDisplay(uid);
                          return (u.name ?? "").split(" ")[0] || "Someone";
                        })
                        .join(", ");
                  return (
                    <View key={cost.id} style={[styles.costRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.costDesc, { color: colors.foreground }]}>{cost.description}</Text>
                        <Text style={[styles.costPayer, { color: colors.mutedForeground }]}>
                          Paid by {payer.id === currentUser.id ? "you" : payer.name}
                        </Text>
                        <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                          Split with: {participantLabel}
                        </Text>
                      </View>
                      <View style={styles.costRight}>
                        <Text style={[styles.costTotal, { color: colors.foreground }]}>${cost.amount.toFixed(2)}</Text>
                        <Text style={[styles.costShare, { color: colors.mutedForeground }]}>
                          you owe ${myShare.toFixed(2)}
                        </Text>
                      </View>
                      {(cost.paidById === currentUser.id || isHost) && (
                        <View style={styles.costActions}>
                          <TouchableOpacity
                            onPress={() => { Haptics.selectionAsync(); openEditCostModal(cost); }}
                            hitSlop={8}
                            style={styles.costActionBtn}
                          >
                            <Ionicons name="pencil" size={17} color={colors.mutedForeground} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => { Haptics.selectionAsync(); confirmDeleteCost(cost); }}
                            hitSlop={8}
                            style={styles.costActionBtn}
                          >
                            <Ionicons name="trash-outline" size={17} color={colors.destructive} />
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </>
            )}
            {!isCancelled && (
              <TouchableOpacity
                onPress={openCostModal}
                style={[styles.addRow, { borderColor: colors.border }]}
              >
                <Ionicons name="add" size={20} color={colors.primary} />
                <Text style={[styles.addText, { color: colors.primary }]}>Add expense</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {tab === "photos" && (
          <EventVaultPanel event={event} authToken={authToken} />
        )}

        {tab === "chat" && (
          <View style={{ gap: 12 }}>
            {event.messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubbles-outline" size={40} color={colors.textDim} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Say hi to your squad below</Text>
              </View>
            ) : (
              event.messages.map((m) => {
                const sender = resolveForDisplay(m.senderId);
                const mine = m.senderId === currentUser.id;
                return (
                  <View key={m.id} style={[styles.msgRow, mine && { flexDirection: "row-reverse" }]}>
                    <UserAvatar initials={sender.initials} color={sender.color} imageUrl={sender.profileImageUrl} size={32} fontSize={11} />
                    <View style={[styles.msgBubble, { backgroundColor: mine ? colors.primary : colors.card, borderColor: colors.border }]}>
                      {!mine && <Text style={[styles.msgSender, { color: colors.mutedForeground }]}>{(sender.name ?? "").split(" ")[0] || "Someone"}</Text>}
                      <Text style={[styles.msgText, { color: mine ? "#fff" : colors.foreground }]}>{m.text}</Text>
                      <Text style={[styles.msgTime, { color: mine ? "rgba(255,255,255,0.7)" : colors.textDim }]}>{m.time}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {tab === "admin" && (
          <View style={{ gap: 12 }}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite code</Text>
              <Text style={[styles.inviteCode, { color: colors.primary }]}>{event.inviteCode}</Text>
              <Text style={[styles.inviteLink, { color: colors.mutedForeground }]}>
                joinsquadz.com/join/{event.inviteCode}
              </Text>
              <TouchableOpacity
                onPress={() => Share.share({ message: `Join ${event.title}! https://joinsquadz.com/join/${event.inviteCode}` })}
                style={[styles.shareInviteBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
              >
                <Ionicons name="share-outline" size={16} color={colors.primary} />
                <Text style={[styles.shareInviteText, { color: colors.primary }]}>Share invite</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={openEdit}
              style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Ionicons name="create-outline" size={20} color={colors.foreground} />
              <Text style={[styles.adminLabel, { color: colors.foreground }]}>Edit event details</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleManualReminder("general")}
              disabled={generalReminderBusy || generalOnCooldown}
              style={[
                styles.adminRow,
                { backgroundColor: colors.card, borderColor: colors.border },
                (generalReminderBusy || generalOnCooldown) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.foreground} />
              <Text style={[styles.adminLabel, { color: colors.foreground }]}>
                {generalOnCooldown ? "General reminder sent (1 h cooldown)" : "Remind everyone (going / maybe)"}
              </Text>
              {generalReminderBusy ? (
                <ActivityIndicator size="small" color={colors.textDim} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleManualReminder("rsvp")}
              disabled={rsvpReminderBusy || rsvpOnCooldown}
              style={[
                styles.adminRow,
                { backgroundColor: colors.card, borderColor: colors.border },
                (rsvpReminderBusy || rsvpOnCooldown) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="mail-outline" size={20} color={colors.foreground} />
              <Text style={[styles.adminLabel, { color: colors.foreground }]}>
                {rsvpOnCooldown ? "RSVP nudge sent (1 h cooldown)" : "Nudge guests who haven't responded"}
              </Text>
              {rsvpReminderBusy ? (
                <ActivityIndicator size="small" color={colors.textDim} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              )}
            </TouchableOpacity>

            {/* Co-admins — host only */}
            {isHost && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Co-admins</Text>
                <Text style={[styles.coAdminHint, { color: colors.mutedForeground }]}>
                  Co-admins can edit event details. Only you can cancel the event or change co-admins.
                </Text>
                {coAdmins.map((u) => (
                  <View key={u.id} style={[styles.coAdminRow, { borderColor: colors.border }]}>
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                    <Text style={[styles.coAdminName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync();
                        void removeEventCoAdmin(event.id, u.id).then((r) => {
                          if (r.error) Alert.alert("Couldn't update", r.error);
                          else void refreshEvents();
                        });
                      }}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={20} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
                {coAdminCandidates.length === 0 ? (
                  <Text style={[styles.coAdminHint, { color: colors.mutedForeground }]}>
                    Invite guests first — then you can make them co-admins.
                  </Text>
                ) : (
                  coAdminCandidates.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        void addEventCoAdmin(event.id, u.id).then((r) => {
                          if (r.error) Alert.alert("Couldn't update", r.error);
                          else void refreshEvents();
                        });
                      }}
                      activeOpacity={0.8}
                      style={[styles.coAdminRow, { borderColor: colors.border }]}
                    >
                      <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                      <Text style={[styles.coAdminName, { color: colors.foreground }]} numberOfLines={1}>{u.name}</Text>
                      <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            {/* Cancel — host only */}
            {isHost && (
              <TouchableOpacity
                onPress={confirmCancel}
                style={[styles.adminRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Ionicons name="trash-outline" size={20} color={colors.destructive} />
                <Text style={[styles.adminLabel, { color: colors.destructive }]}>Cancel event</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Chat composer — replaced with a read-only note when the event is cancelled */}
      {tab === "chat" && isCancelled && (
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: botPad + 10, justifyContent: "center" }]}>
          <Text style={[styles.cardBody, { color: colors.mutedForeground, textAlign: "center", flex: 1 }]}>
            This event was cancelled — chat is closed.
          </Text>
        </View>
      )}
      {tab === "chat" && !isCancelled && (
        <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: botPad + 10 }]}>
          <TextInput
            placeholder="Message your squad..."
            placeholderTextColor={colors.textDim}
            value={chatText}
            onChangeText={setChatText}
            style={[styles.composerInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
          <TouchableOpacity
            onPress={async () => {
              if (chatSending || !chatText.trim()) return;
              const text = chatText.trim();
              setChatText("");
              setChatSending(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              try {
                const result = await sendMessage(event.id, text);
                if (result.error) {
                  setChatText(text);
                  Alert.alert("Couldn't send message", result.error);
                }
              } finally {
                setChatSending(false);
              }
            }}
            disabled={chatSending || !chatText.trim()}
            style={[styles.sendBtn, { backgroundColor: chatText.trim() && !chatSending ? colors.primary : colors.border }]}
          >
            {chatSending ? (
              <ActivityIndicator size="small" color={colors.textDim} />
            ) : (
              <Ionicons name="send" size={18} color={chatText.trim() ? "#fff" : colors.textDim} />
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* ---- Add Food Item Modal ---- */}
      <Modal visible={foodModal} transparent animationType="fade" onRequestClose={() => setFoodModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add to food list</Text>
            <TextInput
              placeholder="e.g. Chips & dip, veggie platter…"
              placeholderTextColor={colors.textDim}
              value={newFoodItem}
              onChangeText={setNewFoodItem}
              autoFocus
              style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setNewFoodItem(""); setFoodModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { void saveFoodItem(); }} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add item</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Add Task Modal ---- */}
      <Modal visible={taskModal} transparent animationType="fade" onRequestClose={() => setTaskModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add a task</Text>
            <TextInput
              placeholder="e.g. Bring the speaker"
              placeholderTextColor={colors.textDim}
              value={newTask}
              onChangeText={setNewTask}
              autoFocus
              style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setNewTask(""); setTaskModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveTask}
                disabled={taskSaving}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: taskSaving ? 0.6 : 1 }]}
              >
                {taskSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Add task</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Add Expense Modal ---- */}
      <Modal visible={costModal} transparent animationType="slide" onRequestClose={() => setCostModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingCostId ? "Edit expense" : "Add expense"}</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              You paid. Choose how to split the bill.
            </Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                placeholder="What's it for? (e.g. Pizza)"
                placeholderTextColor={colors.textDim}
                value={costDesc}
                onChangeText={setCostDesc}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
                <TextInput
                  placeholder="0.00"
                  placeholderTextColor={colors.textDim}
                  value={costTotal}
                  onChangeText={setCostTotal}
                  keyboardType="decimal-pad"
                  style={[styles.amountInput, { color: colors.foreground }]}
                />
              </View>

              {/* Participant picker — only show when there are 2+ RSVP'd guests */}
              {costParticipants.length > 1 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who's included</Text>
                  {costParticipants.map((m) => {
                    const selected = selectedParticipantIds.has(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleSplitParticipant(m.id)}
                        style={[
                          styles.assignRow,
                          { borderColor: selected ? colors.primary + "50" : colors.border, backgroundColor: selected ? colors.primary + "08" : "transparent" },
                        ]}
                        activeOpacity={0.7}
                      >
                        <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                        <Text style={[styles.assignName, { color: colors.foreground, flex: 1 }]}>
                          {(m.name ?? "").split(" ")[0] || "Someone"}{m.id === currentUser.id ? " (You)" : ""}
                        </Text>
                        <View style={[
                          styles.participantCheckbox,
                          { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" },
                        ]}>
                          {selected && <Ionicons name="checkmark" size={13} color="#fff" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {splitParticipants.length === 0 && (
                    <Text style={[styles.assignLabel, { color: colors.destructive, marginTop: 2 }]}>
                      Select at least one person.
                    </Text>
                  )}
                </>
              )}

              {/* Split mode toggle */}
              <View style={[styles.splitToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  onPress={() => setSplitMode("even")}
                  style={[styles.splitToggleBtn, splitMode === "even" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "even" ? "#fff" : colors.mutedForeground }]}>
                    Split evenly
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={switchToManual}
                  style={[styles.splitToggleBtn, splitMode === "manual" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "manual" ? "#fff" : colors.mutedForeground }]}>
                    Enter manually
                  </Text>
                </TouchableOpacity>
              </View>

              {splitParticipants.length > 0 && (
                <>
                  <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Who owes what</Text>
                  {splitParticipants.map((m) => (
                    <View key={m.id} style={[styles.assignRow, { borderColor: colors.border }]}>
                      <UserAvatar initials={m.initials} color={m.color} imageUrl={m.profileImageUrl} size={32} fontSize={11} />
                      <Text style={[styles.assignName, { color: colors.foreground }]}>{(m.name ?? "").split(" ")[0] || "Someone"}{m.id === currentUser.id ? " (You)" : ""}</Text>
                      {splitMode === "even" ? (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                          <Text style={[styles.dollar, { color: colors.primary }]}>$</Text>
                          <Text style={[styles.assignInput, { color: colors.primary, textAlignVertical: "center", paddingTop: 2 }]}>
                            {activeShares[m.id] ?? "—"}
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.assignInputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                          <Text style={[styles.dollar, { color: colors.textDim }]}>$</Text>
                          <TextInput
                            placeholder="0"
                            placeholderTextColor={colors.textDim}
                            value={costShares[m.id] ?? ""}
                            onChangeText={(v) => setCostShares((p) => ({ ...p, [m.id]: v }))}
                            keyboardType="decimal-pad"
                            style={[styles.assignInput, { color: colors.foreground }]}
                          />
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </ScrollView>

            <View style={[styles.coverageBar, { borderColor: covered ? colors.green : colors.border, backgroundColor: (covered ? colors.green : colors.gold) + "15" }]}>
              <Ionicons name={covered ? "checkmark-circle" : "alert-circle-outline"} size={16} color={covered ? colors.green : colors.gold} />
              <Text style={[styles.coverageText, { color: covered ? colors.green : colors.gold }]}>
                {covered
                  ? `Covered · $${totalNum.toFixed(2)} assigned`
                  : `$${assignedNum.toFixed(2)} of $${totalNum.toFixed(2)} · $${remaining.toFixed(2)} left`}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCostModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveCost}
                disabled={totalNum <= 0 || !covered || costSaving}
                style={[styles.modalBtn, { backgroundColor: covered ? colors.primary : colors.border, opacity: (totalNum <= 0 || !covered || costSaving) ? 0.45 : 1 }]}
              >
                {costSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: covered ? "#fff" : colors.textDim }]}>{editingCostId ? "Save changes" : "Save expense"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- New Poll Modal ---- */}
      <Modal visible={pollModal} transparent animationType="slide" onRequestClose={() => setPollModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New poll</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput
                placeholder="Ask a question..."
                placeholderTextColor={colors.textDim}
                value={pollQ}
                onChangeText={setPollQ}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              {pollOpts.map((opt, i) => (
                <TextInput
                  key={i}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={colors.textDim}
                  value={opt}
                  onChangeText={(v) => setPollOpts((p) => p.map((o, idx) => (idx === i ? v : o)))}
                  style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                />
              ))}
              {pollOpts.length < 5 && (
                <TouchableOpacity onPress={() => setPollOpts((p) => [...p, ""])} style={[styles.addRow, { borderColor: colors.border, marginTop: 4 }]}>
                  <Ionicons name="add" size={18} color={colors.primary} />
                  <Text style={[styles.addText, { color: colors.primary }]}>Add option</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setPollQ(""); setPollOpts(["", ""]); setPollModal(false); }} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={savePoll}
                disabled={pollSaving}
                style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: pollSaving ? 0.6 : 1 }]}
              >
                {pollSaving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Create poll</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ---- Edit Event Modal ---- */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit event</Text>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.assignLabel, { color: colors.mutedForeground }]}>Icon</Text>
              <IconPicker value={edit.emoji} onChange={(e) => setEdit((p) => ({ ...p, emoji: e }))} />
              <TextInput
                placeholder="Event title"
                placeholderTextColor={colors.textDim}
                value={edit.title}
                onChangeText={(v) => setEdit((p) => ({ ...p, title: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, marginTop: 12 }]}
              />
              <TextInput
                placeholder="Date & time"
                placeholderTextColor={colors.textDim}
                value={edit.date}
                onChangeText={(v) => setEdit((p) => ({ ...p, date: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <Text style={[styles.assignLabel, { color: colors.mutedForeground, marginTop: 4 }]}>End time (optional)</Text>
              <View style={styles.endRow}>
                <TouchableOpacity
                  onPress={openEndPicker}
                  style={[styles.endPickBtn, { backgroundColor: colors.card, borderColor: editEndAt ? colors.primary : colors.border }]}
                >
                  <Ionicons name="time-outline" size={18} color={editEndAt ? colors.primary : colors.mutedForeground} />
                  <Text style={[styles.endPickText, { color: editEndAt ? colors.foreground : colors.textDim }]} numberOfLines={1}>
                    {editEndAt ? formatEndLabel(editEndAt) : "Add an end time"}
                  </Text>
                </TouchableOpacity>
                {editEndAt ? (
                  <TouchableOpacity onPress={() => setEditEndAt(null)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                    <Ionicons name="close-circle" size={20} color={colors.textDim} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TextInput
                placeholder="Location"
                placeholderTextColor={colors.textDim}
                value={edit.location}
                onChangeText={(v) => setEdit((p) => ({ ...p, location: v }))}
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />
              <TextInput
                placeholder="Description"
                placeholderTextColor={colors.textDim}
                value={edit.description}
                onChangeText={(v) => setEdit((p) => ({ ...p, description: v }))}
                multiline
                style={[styles.modalInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, height: 90, textAlignVertical: "top" }]}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveEdit} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save changes</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* End-time picker rendered IN-SHEET (not a nested Modal) to avoid iOS stacked-modal freeze */}
          {Platform.OS === "ios" && endPickerStep !== null && (
            <View style={styles.endPickerOverlay}>
              <View style={[styles.endPickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
                <View style={[styles.endPickerToolbar, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity onPress={() => setEndPickerStep(null)} style={{ minWidth: 60 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>
                    {endPickerStep === "date" ? "End date" : "End time"}
                  </Text>
                  <TouchableOpacity onPress={handleEndIOSConfirm} style={{ minWidth: 60 }}>
                    <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700", textAlign: "right" }}>
                      {endPickerStep === "date" ? "Next →" : "Done"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={endPickerDate}
                  mode={endPickerStep}
                  display="spinner"
                  minimumDate={eventStart ?? undefined}
                  onChange={(_, d) => { if (d) setEndPickerDate(d); }}
                  themeVariant="dark"
                  style={{ width: "100%", height: 200 }}
                />
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Android end-time picker (native dialog — safe outside the modal) */}
      {Platform.OS === "android" && endPickerStep !== null && (
        <DateTimePicker
          value={endPickerDate}
          mode={endPickerStep}
          display="default"
          minimumDate={eventStart ?? undefined}
          onChange={handleEndAndroidChange}
        />
      )}

      {/* ---- Budget Modal ---- */}
      <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Group budget</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              Set a target the whole squad can track against.
            </Text>
            <View style={[styles.modalInput, styles.amountRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.dollar, { color: colors.mutedForeground }]}>$</Text>
              <TextInput
                placeholder="0.00"
                placeholderTextColor={colors.textDim}
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                autoFocus
                style={[styles.amountInput, { color: colors.foreground }]}
              />
            </View>
            {hasBudget && (
              <TouchableOpacity onPress={clearBudget} style={[styles.addRow, { borderColor: colors.border, marginTop: 4 }]}>
                <Ionicons name="trash-outline" size={18} color={colors.destructive} />
                <Text style={[styles.addText, { color: colors.destructive }]}>Remove budget</Text>
              </TouchableOpacity>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setBudgetModal(false)} style={[styles.modalBtn, { backgroundColor: colors.card }]}>
                <Text style={[styles.modalBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveBudget} style={[styles.modalBtn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save budget</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <FindTimeChooser
        visible={findTimeOpen}
        scope={{ type: "event", eventId: event.id }}
        onClose={() => setFindTimeOpen(false)}
        onStartNew={() =>
          router.push({ pathname: "/availability", params: { eventId: event.id, from: "create" } } as never)
        }
      />

      <ContactSheet
        visible={contactOpen}
        member={contactMember}
        onClose={() => setContactOpen(false)}
      />
      <FriendPickerSheet
        visible={showInvitePicker}
        title="Invite friends"
        confirmLabel="Invite"
        excludeIds={[event.hostId, ...Object.keys(event.rsvps), ...(event.invitedUserIds ?? [])]}
        onClose={() => setShowInvitePicker(false)}
        onConfirm={async (ids) => {
          const res = await inviteToEvent(event.id, ids);
          setShowInvitePicker(false);
          if (res.error) Alert.alert("Couldn't invite", res.error);
        }}
      />
      <CelebrationOverlay
        visible={firstRsvpCelebration}
        emoji="🎉"
        title="Your first RSVP!"
        subtitle="Someone's coming. The plan is officially happening!"
        ctaLabel="Let's go"
        onClose={() => setFirstRsvpCelebration(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: { backgroundColor: "#FF6B2C", paddingHorizontal: 20, paddingBottom: 20, position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 16, padding: 8, zIndex: 10 },
  shareBtn: { position: "absolute", top: 0, right: 16, padding: 8, zIndex: 10 },
  gearBtn: { position: "absolute", top: 0, right: 54, padding: 8, zIndex: 10 },
  budgetCard: { borderRadius: 14, borderWidth: 1, padding: 16 },
  budgetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  budgetEdit: { flexDirection: "row", alignItems: "center", gap: 3 },
  budgetEditText: { fontSize: 13, fontWeight: "700" },
  budgetAmount: { fontSize: 26, fontWeight: "900", marginTop: 4, marginBottom: 12 },
  budgetTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  budgetFill: { height: 8, borderRadius: 4 },
  budgetMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  budgetMeta: { fontSize: 13, fontWeight: "700" },
  budgetPer: { fontSize: 12, marginTop: 6 },
  heroEmoji: { fontSize: 48, textAlign: "center", marginTop: 20, marginBottom: 8 },
  heroTitleRow: { alignItems: "center", gap: 6, marginBottom: 4 },
  heroTitle: { fontSize: 24, fontWeight: "800", color: "#fff", textAlign: "center" },
  heroHostBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  heroHostText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroDate: { fontSize: 14, color: "rgba(255,255,255,0.85)", textAlign: "center", fontWeight: "600", marginBottom: 2 },
  heroLocation: { fontSize: 13, color: "rgba(255,255,255,0.75)", textAlign: "center", marginBottom: 14 },
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 14,
  },
  countdownText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  rsvpRow: { flexDirection: "row", gap: 8, justifyContent: "center" },
  cancelledBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: "center",
  },
  cancelledBannerText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  pollClosedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pollClosedText: { fontSize: 11, fontWeight: "700" },
  rsvpBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8 },
  rsvpText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  rsvpMoment: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 12, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: "rgba(255,255,255,0.14)", alignSelf: "center",
  },
  rsvpMomentAvatars: { flexDirection: "row", alignItems: "center" },
  rsvpMomentText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  recapStrip: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  recapTitle: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  recapRow: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  recapItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  recapItemText: { fontSize: 13, fontWeight: "700" },
  tabBar: { maxHeight: 52, borderBottomWidth: 1 },
  tabChip: { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginVertical: 8 },
  tabChipText: { fontSize: 13, fontWeight: "700" },
  tabContent: { flex: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBody: { fontSize: 15, lineHeight: 22 },
  inlineAdd: { flexDirection: "row", alignItems: "center", gap: 2 },
  inlineAddText: { fontSize: 13, fontWeight: "700" },
  pollQ: { fontSize: 15, fontWeight: "700", marginTop: 2 },
  pollOpt: { borderRadius: 10, borderWidth: 1.5, overflow: "hidden", justifyContent: "center", minHeight: 42 },
  pollFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  pollOptRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  pollOptLabel: { flex: 1, fontSize: 14, fontWeight: "600" },
  pollPct: { fontSize: 13, fontWeight: "700" },
  pollMeta: { fontSize: 12, marginTop: 2 },
  hostRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  hostName: { fontSize: 15, fontWeight: "700" },
  sectionLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 },
  guestRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  inviteFriendsRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", paddingVertical: 12 },
  inviteFriendsText: { fontSize: 14, fontWeight: "700" },
  guestName: { fontSize: 14, fontWeight: "700" },
  guestStatus: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  hostBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  hostBadgeText: { fontSize: 11, fontWeight: "700" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  taskText: { flex: 1, fontSize: 14 },
  claimBtn: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  claimText: { fontSize: 12, fontWeight: "700" },
  totalsCard: { flexDirection: "row", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 4 },
  totalsValue: { fontSize: 22, fontWeight: "900", marginTop: 2 },
  costRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14 },
  costDesc: { fontSize: 14, fontWeight: "700" },
  costActions: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8 },
  costActionBtn: { padding: 6 },
  costPayer: { fontSize: 12, marginTop: 2 },
  costRight: { alignItems: "flex-end" },
  costTotal: { fontSize: 16, fontWeight: "800" },
  costShare: { fontSize: 12 },
  settleCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  settleHeader: { fontSize: 15, fontWeight: "800" },
  settleAllClear: { fontSize: 13 },
  settleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  settleName: { fontSize: 13, fontWeight: "600" },
  settleAmt: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  settleActions: { flexDirection: "row", gap: 8 },
  payBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  payBtnText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  addRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", padding: 14 },
  addText: { fontSize: 14, fontWeight: "700" },
  inviteCode: { fontSize: 24, fontWeight: "800", letterSpacing: 2 },
  inviteLink: { fontSize: 12 },
  shareInviteBtn: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, alignSelf: "flex-start", marginTop: 4 },
  shareInviteText: { fontSize: 13, fontWeight: "700" },
  adminRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  adminLabel: { flex: 1, fontSize: 15 },
  coAdminHint: { fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 8 },
  coAdminRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 10 },
  coAdminName: { flex: 1, fontSize: 15, fontWeight: "600" },
  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center" },
  errorText: { textAlign: "center", marginTop: 80, fontSize: 16 },
  // vault photos
  proLoadingCenter: { alignItems: "center", paddingVertical: 40 },
  vaultPhotoGrid: { flexDirection: "row", gap: 6 },
  vaultGridCell: { flex: 1, aspectRatio: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", position: "relative" },
  vaultGridEmoji: { fontSize: 28 },
  vaultLockBadge: { position: "absolute", bottom: 6, right: 6, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  vaultLockCard: { borderRadius: 20, borderWidth: 1, padding: 24, alignItems: "center" },
  vaultLockIcon: { fontSize: 44, marginBottom: 12 },
  vaultLockTitle: { fontSize: 18, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  vaultLockBody: { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  vaultFeaturePills: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  vaultPill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  vaultPillText: { fontSize: 12 },
  vaultUpgradeBtn: { borderRadius: 14, padding: 16, alignItems: "center" },
  vaultUpgradeBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  vaultCta: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  vaultCtaText: { flex: 1, fontSize: 14, fontWeight: "700" },
  // chat
  msgRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  msgBubble: { maxWidth: "78%", borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  msgSender: { fontSize: 11, fontWeight: "700", marginBottom: 2 },
  msgText: { fontSize: 14, lineHeight: 19 },
  msgTime: { fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1 },
  composerInput: { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, height: 44, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  // modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 12 },
  modalCardLarge: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 10 },
  modalTitle: { fontSize: 19, fontWeight: "800" },
  modalHint: { fontSize: 13, marginTop: -4 },
  modalInput: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 50, fontSize: 15, marginTop: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dollar: { fontSize: 16, fontWeight: "700" },
  amountInput: { flex: 1, fontSize: 16, fontWeight: "700", height: "100%" },
  splitToggle: { flexDirection: "row", borderRadius: 12, borderWidth: 1.5, marginTop: 10, overflow: "hidden" },
  splitToggleBtn: { flex: 1, paddingVertical: 9, alignItems: "center", justifyContent: "center" },
  splitToggleText: { fontSize: 13, fontWeight: "700" },
  assignLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
  endRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  endPickBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, height: 50 },
  endPickText: { flex: 1, fontSize: 15, fontWeight: "600" },
  endPickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  endPickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  endPickerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  assignRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  assignName: { flex: 1, fontSize: 14, fontWeight: "600" },
  participantCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  assignInputWrap: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, width: 100, height: 40 },
  assignInput: { flex: 1, fontSize: 14, fontWeight: "700", height: "100%" },
  coverageBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  coverageText: { fontSize: 13, fontWeight: "700" },
  emojiOption: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14 },
  modalBtnText: { fontSize: 15, fontWeight: "800" },
  responseBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", marginRight: 4 },
  responseBadgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  conflictBanner: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#F59E0B18" },
  conflictBannerText: { fontSize: 12, fontWeight: "700", color: "#B45309", letterSpacing: 0.2 },
});
