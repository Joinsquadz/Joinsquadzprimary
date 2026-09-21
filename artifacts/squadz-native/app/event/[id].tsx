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
import { isEventPast, nextEventCompletionDelay, resolveEventStart } from "@/lib/calendar";
import { buildPlanIcs } from "@/lib/ics";
import { shareIcsFile } from "@/lib/shareIcs";
import { findMyConflicts, getPlanSpan } from "@/lib/conflicts";
import ConflictBanner from "@/components/ConflictBanner";
import { scheduleRsvpReminder } from "@/lib/reminders";
import { computeEvenShares, computeWeightedShares, isWholeCent } from "@/lib/costSplit";
import { BillDetailsFields, formatBillDetails, useBillDetailsForm } from "@/components/BillDetailsFields";
import { sendManualReminder } from "@/lib/api";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useColors } from "@/hooks/useColors";
import { useEventStream } from "@/hooks/useEventStream";
import { useData, useAuth, dbEventToEvent } from "@/context/AppContext";
import { ChatMessages, ChatComposer } from "@/components/EventChatPanel";
import { useEventChat } from "@/hooks/useEventChat";
import { FindTimeChooser } from "@/components/FindTimeChooser";
import { ActivePollList } from "@/components/ActivePollList";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { UserAvatar } from "@/components/UserAvatar";
import { ProAvatar } from "@/components/ProAvatar";
import { ContactSheet } from "@/components/ContactSheet";
import AddressLink from "@/components/AddressLink";
import FriendPickerSheet from "@/components/FriendPickerSheet";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { claimOnce } from "@/lib/seenFlags";
import { goingCount, eventRosterKey } from "@/lib/eventUtils";
import { IdeaSheet } from "@/components/IdeaSheet";
import { KeyboardDismissControl } from "@/components/KeyboardDismissControl";
import { KeyboardAvoidingSheet } from "@/components/KeyboardAvoidingSheet";
import { IdeaCard } from "@/components/IdeaCard";
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
import { sortPendingIdeas, applyVoteToggle, moveWithinGroup, type PendingSort } from "@/lib/ideaUtils";
import type { PlanIdea } from "@/types";
import type { RsvpStatus } from "@/types";
import { useUserCache, type ResolvedUser } from "@/context/UserCacheContext";
import { useTips } from "@/context/TipsContext";
import { useTimezone, runtimeTimezone, zoneLabel } from "@/context/TimezoneContext";
import { deviceWallClockToZoneIso, instantToZoneWallClockDate } from "@/lib/timezoneFormat";
import { IconPicker } from "@/components/IconPicker";
import { EventVaultPanel } from "@/components/EventVaultPanel";
import { AddFriendBadge } from "@/components/AddFriendBadge";
import { planInviteUrl } from "@/lib/inviteLinks";
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

const MAX_TIMER_DELAY_MS = 2_147_000_000;

type EventTab = "overview" | "ideas" | "guests" | "tasks" | "food" | "costs" | "chat" | "photos" | "admin";

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
    refreshEvents,
    refreshEvent,
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
    apiFetch,
  } = useData();
  const { formatEventTime, formatInstant, timezone } = useTimezone();
  // Times entered on this screen (edit modal end-time picker) are wall clocks
  // in the user's *effective* zone, which can differ from the device zone.
  const deviceZone = runtimeTimezone();
  const zoneDiffers = timezone !== deviceZone;

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
  const [completionTick, setCompletionTick] = useState(0);
  const event = ctxEvent ?? fallbackEvent;

  useEffect(() => {
    const delay = event ? nextEventCompletionDelay([event]) : null;
    if (delay === null) return;
    const timer = setTimeout(
      () => setCompletionTick((tick) => tick + 1),
      Math.min(delay + 1, MAX_TIMER_DELAY_MS),
    );
    return () => clearTimeout(timer);
  }, [event?.id, event?.date, event?.eventAt, event?.startAt, event?.endAt, completionTick]);

  const fetchFallbackEvent = useCallback(async (track = false) => {
    if (!id) return;
    try {
      const res = await apiFetch(`/api/events/${id}`);
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        setFallbackEvent(dbEventToEvent(data));
        if (track) setFallbackAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "ok" }));
        return;
      }
      if (track) {
        // 403/404 are authenticated "you can't see this" answers — terminal, so
        // they must resolve to the error state instead of spinning forever
        // (a pending invitee tapping an invite push lands here).
        const kind =
          res.status === 401
            ? "unauthorized"
            : res.status === 403 || res.status === 404
              ? "denied"
              : "failure";
        setFallbackAuthRace((prev) => applyVaultFetchOutcome(prev, { kind }));
      }
    } catch {
      if (track) setFallbackAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "failure" }));
    }
  }, [id, apiFetch]);

  // Keep the currently open plan authoritative. The upcoming-events list is a
  // useful cache for cards, but RSVP changes on an already open detail need to
  // replace this one record immediately (and past plans live only in the
  // screen-local fallback).
  const refreshCurrentEvent = useCallback(async () => {
    if (!id) return;
    const updated = await refreshEvent(id);
    if (updated) setFallbackEvent(updated);
  }, [id, refreshEvent]);

  // On mount / when context misses (past event), hydrate the fallback.
  useEffect(() => {
    if (!ctxEvent && id && authToken) void fetchFallbackEvent(true);
  }, [ctxEvent, id, authToken, fetchFallbackEvent]);

  // ── Ideas (suggest & vote) — separate table, so they refresh independently
  // of event.version: on mount + a 30s poll + after every idea mutation.
  const [ideas, setIdeas] = useState<PlanIdea[]>([]);
  const [ideasReadOnly, setIdeasReadOnly] = useState(false);
  const [ideaSheetOpen, setIdeaSheetOpen] = useState(false);
  const [editingIdea, setEditingIdea] = useState<PlanIdea | null>(null);
  const [ideaBusy, setIdeaBusy] = useState(false);
  const [ideaSort, setIdeaSort] = useState<PendingSort>("votes");
  const [showArchivedIdeas, setShowArchivedIdeas] = useState(false);
  const [ideaReordering, setIdeaReordering] = useState(false);
  const ideaVoteInFlight = useRef<Set<string>>(new Set());
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
    const interval = setInterval(() => { void refreshIdeas(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshIdeas]);

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
    : tabParam === "ideas" ? "ideas"
    : "overview";
  const [tab, setTab] = useState<EventTab>(initialTab);
  // Event chat is a real conversation thread (paginated + server-side read
  // receipts). The thread is created lazily the first time the Chat tab opens.
  const chat = useEventChat(event?.id, tab === "chat");
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => {
    if (inviteCopyTimer.current) clearTimeout(inviteCopyTimer.current);
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

  const openUserProfile = useCallback((userId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((userId === currentUser.id ? "/profile" : `/user/${userId}`) as never);
  }, [currentUser.id]);

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

  // Pre-load all user profiles referenced in this event.
  // Keyed on the roster itself (not just event.id): when someone RSVPs or is
  // invited while this screen is open, their id is new to the user cache and
  // would otherwise render as a "..." placeholder until the screen remounts.
  const rosterKey = event ? eventRosterKey(event) : "";
  useEffect(() => {
    if (!event) return;
    const s = getSquad(event.squadId);
    const ids = [
      event.hostId,
      ...(s?.memberIds ?? []),
      ...Object.keys(event.rsvps),
      ...(event.invitedUserIds ?? []),
      ...event.tasks.filter((t) => t.assigneeId).map((t) => t.assigneeId!),
      ...event.costs.map((c) => c.paidById),
    ];
    prefetchUsers(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, rosterKey]);
  const [newResponseCount, setNewResponseCount] = useState(0);
  const [pollListRefreshKey, setPollListRefreshKey] = useState(0);
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
    const start = resolveEventStart(event);
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
      void refreshCurrentEvent();
      // Re-fetch the inline active-poll list whenever this screen regains focus.
      setPollListRefreshKey((k) => k + 1);
      // Badge spans ALL of the caller's active polls for this event, not just
      // the newest one /find used to return.
      Promise.all([
        fetch(`${API_BASE}/api/availability/polls?eventId=${id}`, { headers: authHeaders() })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
        AsyncStorage.getItem(avKey).catch(() => null),
      ]).then(([d, stored]: [{ polls?: { createdBy: string; lastResponseAt?: string | null }[] } | null, string | null]) => {
        if (!active) return;
        if (!d?.polls || !stored) {
          setNewResponseCount(0);
          return;
        }
        const lastViewedAt = new Date(Number(stored));
        const count = d.polls.filter(
          (p) =>
            p.createdBy === currentUser.id &&
            p.lastResponseAt != null &&
            new Date(p.lastResponseAt) > lastViewedAt,
        ).length;
        setNewResponseCount(count);
      });
      return () => { active = false; };
    }, [id, authHeaders, currentUser.id, refreshCurrentEvent])
  );

  // SSE stream: instantly refreshes event data (RSVPs, messages, tasks, costs,
  // polls) when any teammate mutates the event — no polling lag.
  useEventStream({
    eventId: id ?? null,
    authToken,
    onUpdate: refreshCurrentEvent,
  });

  // 30 s safety-net poll: catches any updates missed when the stream is
  // temporarily unavailable (network blip, proxy timeout, etc.).
  useEffect(() => {
    const interval = setInterval(() => { void refreshCurrentEvent(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshCurrentEvent]);

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
  const [costWeights, setCostWeights] = useState<Record<string, string>>({});
  const [splitMode, setSplitMode] = useState<"even" | "manual" | "weighted">("even");
  const bill = useBillDetailsForm();
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

  // ── Ideas derived state + handlers (mirrors the trip screen; events have no
  // day groups, so confirmed ideas are one flat sortOrder-ordered list).
  const pendingIdeas = sortPendingIdeas(ideas.filter((i) => i.status === "pending"), ideaSort);
  const archivedIdeas = ideas.filter((i) => i.status === "archived");
  const confirmedIdeas = ideas
    .filter((i) => i.status === "confirmed")
    // Guard: createdAt is required by the type but guard against a null from an
    // older API row to avoid a localeCompare throw crashing the screen.
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

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

  const openSuggestIdea = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingIdea(null);
    setIdeaSheetOpen(true);
  };

  const openEditIdea = (idea: PlanIdea) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingIdea(idea);
    setIdeaSheetOpen(true);
  };

  const submitIdea = (data: NewIdeaInput | IdeaPatch, isEdit: boolean) => {
    setIdeaSheetOpen(false);
    void runIdeaMut(async () => {
      if (isEdit && editingIdea) return patchIdea(event.id, editingIdea.id, authToken, data as IdeaPatch);
      return createIdea(event.id, authToken, data as NewIdeaInput);
    });
  };

  // Optimistic vote toggle: flip locally, reconcile with the server response.
  // One in-flight toggle per idea — rapid double-taps otherwise race, letting
  // a delayed older response overwrite the newer server state.
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

  const handleIdeaMoveFlat = (ideaId: string, dir: "up" | "down") => {
    const ids = moveWithinGroup(confirmedIdeas, ideaId, dir);
    if (!ids) return;
    Haptics.selectionAsync();
    void runIdeaMut(() => reorderIdeas(event.id, authToken, null, ids));
  };

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
    const start = resolveEventStart(event);
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
    { key: "ideas", label: "💡 Ideas" },
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
    bill.reset();
    setCostShares({});
    setCostWeights({});
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
    bill.loadFrom(cost.billDetails);
    const shareMap: Record<string, string> = {};
    cost.shares.forEach((s) => { shareMap[s.userId] = String(s.amount); });
    setCostShares(shareMap);
    setCostWeights({});
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

  const totalNum = bill.show ? bill.billTotal : parseFloat(costTotal) || 0;

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

  const evenShares = computeEvenShares(totalNum, splitParticipants.map((member) => member.id));
  const parsedWeights = Object.fromEntries(
    splitParticipants.map((m) => [m.id, parseFloat(costWeights[m.id] || "0") || 0]),
  );
  const totalWeight = splitParticipants.reduce((s, m) => s + (parsedWeights[m.id] || 0), 0);
  const weightedShares = computeWeightedShares(totalNum, parsedWeights);
  const activeShares =
    splitMode === "even" ? evenShares
    : splitMode === "weighted" ? weightedShares
    : costShares;
  const shareValues = splitParticipants.map((m) => parseFloat(activeShares[m.id] || "0") || 0);
  const hasNegative = shareValues.some((v) => v < 0);
  const assignedNum = shareValues.reduce((sum, v) => sum + v, 0);
  const remaining = totalNum - assignedNum;
  const covered =
    totalNum > 0 && splitParticipants.length > 0 && !hasNegative &&
    (splitMode === "weighted" ? totalWeight > 0 : Math.abs(remaining) < 0.01);

  const switchToManual = () => {
    // Pre-fill manual inputs with whatever the current mode computes.
    setCostShares(splitMode === "weighted" ? { ...weightedShares } : { ...evenShares });
    setSplitMode("manual");
  };

  const switchToWeighted = () => {
    // Even → weighted: equal weights. Manual → weighted: use dollar amounts as weights.
    const newWeights: Record<string, string> = {};
    splitParticipants.forEach((m) => {
      newWeights[m.id] = splitMode === "manual" ? (costShares[m.id] ?? "1") : "1";
    });
    setCostWeights(newWeights);
    setSplitMode("weighted");
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
    if (!isWholeCent(totalNum) || shareValues.some((amount) => !isWholeCent(amount))) {
      Alert.alert("Use cents", "Enter amounts with no more than two decimal places.");
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
      const payload = { description: costDesc.trim(), amount: totalNum, shares, billDetails: bill.billDetails };
      const result = editingCostId
        ? await updateCost(event.id, editingCostId, payload, event.version)
        : await addCost(event.id, payload, event.version);
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
  const eventStart = resolveEventStart(event);
  const isCancelled = !!event.cancelled;
  const isPastEvent = isEventPast(event);
  const saveEdit = () => {
    if (!edit.title.trim()) {
      Alert.alert("Missing info", "Event needs a title.");
      return;
    }
    // editEndAt is ALWAYS an absolute instant: the picker works on a
    // chosen-zone wall-clock surrogate and converts back on confirm, so no
    // reinterpretation is needed (or safe) here.
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

  // The native picker can only display a Date's *device-local* fields, but
  // times on this screen are wall clocks in the user's chosen zone. So the
  // picker works on a surrogate: existing instants are converted to their
  // chosen-zone wall clock before seeding, and the picked wall clock is
  // converted back to an absolute instant on confirm. When the chosen zone
  // matches the device zone both conversions are identities.
  const openEndPicker = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEndPickerDate(
      instantToZoneWallClockDate(editEndAt ? new Date(editEndAt) : eventStart ?? new Date(), timezone),
    );
    setEndPickerStep("date");
  };
  // Floor for the picker in the same surrogate space (chosen-zone wall clock
  // of the event's start) — the real instant would block valid end times.
  const endPickerMinimum = eventStart ? instantToZoneWallClockDate(eventStart, timezone) : undefined;
  const handleEndIOSConfirm = () => {
    if (endPickerStep === "date") {
      setEndPickerStep("time");
    } else {
      setEditEndAt(deviceWallClockToZoneIso(endPickerDate, timezone));
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
      setEditEndAt(deviceWallClockToZoneIso(updated, timezone));
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
        <TouchableOpacity
          onPress={goBack}
          style={[styles.backBtn, { top: btnTop }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Share.share({ message: `Join ${event.title}! ${planInviteUrl(event.inviteCode)}` })}
          style={[styles.shareBtn, { top: btnTop }]}
          accessibilityRole="button"
          accessibilityLabel="Share event invite"
        >
          <Ionicons name="share-outline" size={22} color="#fff" />
        </TouchableOpacity>
        {canManage && (
          <TouchableOpacity
            onPress={openEdit}
            style={[styles.gearBtn, { top: btnTop }]}
            accessibilityRole="button"
            accessibilityLabel="Event settings"
          >
            <Ionicons name="settings-outline" size={21} color="#fff" />
          </TouchableOpacity>
        )}
        <View style={styles.heroSummary}>
          <Text style={styles.heroEmoji}>{event.emoji}</Text>
          <View style={styles.heroSummaryBody}>
            <Animated.View
              style={[
                styles.heroTitleRow,
                {
                  backgroundColor: titleHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }),
                },
              ]}
            >
              <Text style={styles.heroTitle} numberOfLines={2}>{event.title}</Text>
              {isHost && (
                <View style={styles.heroHostBadge}>
                  <Ionicons name="star" size={10} color="#fff" />
                  <Text style={styles.heroHostText}>Hosting</Text>
                </View>
              )}
            </Animated.View>
            <Animated.View
              style={[
                styles.heroMetaRow,
                { backgroundColor: dateHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }) },
              ]}
            >
              <Ionicons name="calendar-outline" size={13} color="rgba(255,255,255,0.9)" />
              <Text style={styles.heroDate} numberOfLines={1}>{formatEventTime(event)}</Text>
            </Animated.View>
            {event.endAt ? (
              <View style={styles.heroMetaRow}>
                <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.9)" />
                <Text style={styles.heroDate} numberOfLines={1}>Ends {formatInstant(event.endAt) || formatEndLabel(event.endAt)}</Text>
              </View>
            ) : null}
            {!!event.location && (
              <Animated.View
                style={[
                  styles.heroMetaRow,
                  { backgroundColor: locationHighlightAnim.interpolate({ inputRange: [0, 1], outputRange: ["rgba(245,158,11,0)", "rgba(245,158,11,0.28)"] }) },
                ]}
              >
                <AddressLink
                  location={event.location}
                  textStyle={styles.heroLocation}
                  iconColor="rgba(255,255,255,0.9)"
                />
              </Animated.View>
            )}
          </View>
        </View>

        {(() => {
          const start = resolveEventStart(event);
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
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => openUserProfile(u.id)}
                    style={{ marginLeft: i === 0 ? 0 : -8 }}
                    accessibilityLabel={`Open ${u.name}'s profile`}
                  >
                    <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={24} fontSize={9} />
                  </TouchableOpacity>
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
              const start = resolveEventStart(event);
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
                <Text style={[styles.cardBody, { color: colors.foreground, fontWeight: "700" }]}>Find the Best Time</Text>
                <Text style={[styles.cardBody, { color: colors.mutedForeground, fontSize: 13 }]}>Poll everyone & lock in when most can make it</Text>
              </View>
              {newResponseCount > 0 && (
                <View style={[styles.responseBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.responseBadgeText}>{newResponseCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </TouchableOpacity>

            {/* Every ACTIVE poll for this plan, capped — an event can have more
                than one live poll and all of them must be reachable here. */}
            <ActivePollList
              scope={{ type: "event", eventId: event.id }}
              refreshKey={pollListRefreshKey}
              onSeeAll={() => setFindTimeOpen(true)}
            />

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
                <TouchableOpacity onPress={() => openUserProfile(host.id)} accessibilityLabel={`Open ${host.name}'s profile`}>
                  <UserAvatar initials={host.initials} color={host.color} imageUrl={host.profileImageUrl} size={40} fontSize={14} />
                </TouchableOpacity>
                <Text style={[styles.hostName, { color: colors.foreground }]}>{host.name}{isHost ? " (You)" : ""}</Text>
              </View>
            </View>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Squad</Text>
              <Text style={[styles.cardBody, { color: colors.foreground }]}>{squadName}</Text>
            </View>

            {/* Invite code — visible to all members */}
            <View style={[styles.card, styles.inviteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.inviteHeadingRow}>
                <View style={styles.inviteTextColumn}>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite friends</Text>
                  <Text
                    style={[styles.inviteCode, { color: colors.foreground }]}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    accessibilityLabel={`Invite code ${event.inviteCode}`}
                  >
                    {event.inviteCode}
                  </Text>
                </View>
                <View style={styles.inviteActions}>
                  <TouchableOpacity
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      await Clipboard.setStringAsync(planInviteUrl(event.inviteCode));
                      setInviteCopied(true);
                      if (inviteCopyTimer.current) clearTimeout(inviteCopyTimer.current);
                      inviteCopyTimer.current = setTimeout(() => setInviteCopied(false), 2200);
                    }}
                    style={[styles.inviteActionBtn, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}
                    accessibilityRole="button"
                    accessibilityLabel={inviteCopied ? "Invite link copied" : "Copy invite link"}
                    accessibilityLiveRegion="polite"
                  >
                    <Ionicons name={inviteCopied ? "checkmark" : "copy-outline"} size={17} color={inviteCopied ? colors.green : colors.primary} />
                    <Text style={[styles.inviteActionText, { color: inviteCopied ? colors.green : colors.primary }]}>{inviteCopied ? "Copied" : "Copy"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      Share.share({ message: `Join ${event.title}! ${planInviteUrl(event.inviteCode)}` });
                    }}
                    style={[styles.inviteActionBtn, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}
                    accessibilityRole="button"
                    accessibilityLabel="Share invite link"
                  >
                    <Ionicons name="share-outline" size={17} color={colors.primary} />
                    <Text style={[styles.inviteActionText, { color: colors.primary }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
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

            {/* Confirmed ideas — voted in on the Ideas tab, locked in here */}
            {confirmedIdeas.length > 0 && (
              <View style={{ marginTop: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Confirmed ideas</Text>
                  {ideaReordering ? (
                    <TouchableOpacity
                      onPress={() => setIdeaReordering(false)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Done reordering"
                    >
                      <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "800" }}>Done</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
                {confirmedIdeas.map((idea, idx) => (
                  <IdeaCard
                    key={idea.id}
                    idea={idea}
                    variant="inline"
                    isMine={idea.submittedBy?.id === currentUser.id}
                    canManage={canManage}
                    readOnly={ideasReadOnly}
                    reordering={ideaReordering}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < confirmedIdeas.length - 1}
                    onEdit={() => openEditIdea(idea)}
                    onDelete={() => confirmDeleteIdea(idea)}
                    onUnconfirm={() => runIdeaStatus(idea, "pending")}
                    onMove={(dir) => handleIdeaMoveFlat(idea.id, dir)}
                    onEnterReorder={confirmedIdeas.length > 1 ? () => setIdeaReordering(true) : undefined}
                  />
                ))}
              </View>
            )}
          </View>
        )}

        {/* IDEAS — suggest & vote board */}
        {tab === "ideas" && (
          <View>
            {ideasReadOnly ? (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 12 }]}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                  This event has wrapped — ideas are read-only.
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                onPress={openSuggestIdea}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: colors.primary + "66",
                  borderRadius: 14,
                  paddingVertical: 14,
                  marginBottom: 14,
                }}
                accessibilityRole="button"
                accessibilityLabel="Suggest an idea"
              >
                <Ionicons name="bulb-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "800" }}>Suggest an idea</Text>
              </TouchableOpacity>
            )}

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
              <View style={{ alignItems: "center", paddingVertical: 36, gap: 8 }}>
                <Ionicons name="bulb-outline" size={40} color={colors.textDim} />
                <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "800" }}>No ideas yet</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, textAlign: "center", paddingHorizontal: 24 }}>
                  Be the first to suggest something. The group votes, organizers lock it in.
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

            {confirmedIdeas.length > 0 ? (
              <TouchableOpacity
                onPress={() => { Haptics.selectionAsync(); setTab("overview"); }}
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
                  {confirmedIdeas.length} confirmed {confirmedIdeas.length === 1 ? "idea is" : "ideas are"} on the Overview
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
              <View
                key={u.id}
                style={[styles.guestRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TouchableOpacity
                  onPress={() => openUserProfile(u.id)}
                  accessibilityLabel={`Open ${u.name}'s profile`}
                  hitSlop={8}
                >
                  <ProAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={44} fontSize={15} isPro={u.isPro} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  activeOpacity={0.7}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setContactMember(u);
                    setContactOpen(true);
                  }}
                >
                  <Text style={[styles.guestName, { color: colors.foreground }]}>{u.name}{u.id === currentUser.id ? " (You)" : ""}</Text>
                  <Text style={[styles.guestStatus, { color: statusColor(status) }]}>{STATUS_LABEL[status]}</Text>
                </TouchableOpacity>
                {/* Being on the same guest list isn't a friendship — DMs need one. */}
                {u.id !== currentUser.id && (
                  <View style={{ alignItems: "flex-end" }}>
                    <AddFriendBadge userId={u.id} />
                  </View>
                )}
                {u.id === event.hostId && (
                  <View style={[styles.hostBadge, { backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
                    <Text style={[styles.hostBadgeText, { color: colors.gold }]}>Host</Text>
                  </View>
                )}
                {u.id !== currentUser.id && (
                  <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
                )}
              </View>
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
                    <TouchableOpacity onPress={() => openUserProfile(assignee.id)} accessibilityLabel={`Open ${assignee.name}'s profile`}>
                      <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                    </TouchableOpacity>
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
                            <TouchableOpacity onPress={() => openUserProfile(assignee.id)} accessibilityLabel={`Open ${assignee.name}'s profile`}>
                              <UserAvatar initials={assignee.initials} color={assignee.color} imageUrl={assignee.profileImageUrl} size={28} fontSize={10} />
                            </TouchableOpacity>
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
                        {cost.billDetails && (
                          <Text style={[styles.costPayer, { color: colors.mutedForeground }]} numberOfLines={2}>
                            {formatBillDetails(cost.billDetails)}
                          </Text>
                        )}
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
            <ChatMessages chat={chat} />
          </View>
        )}

        {tab === "admin" && (
          <View style={{ gap: 12 }}>
            <View style={[styles.card, styles.inviteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.inviteHeadingRow}>
                <View style={styles.inviteTextColumn}>
                  <Text style={[styles.cardTitle, { color: colors.mutedForeground }]}>Invite code</Text>
                  <Text style={[styles.inviteCode, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="middle" accessibilityLabel={`Invite code ${event.inviteCode}`}>
                    {event.inviteCode}
                  </Text>
                </View>
                <View style={styles.inviteActions}>
                  <TouchableOpacity
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      await Clipboard.setStringAsync(planInviteUrl(event.inviteCode));
                      setInviteCopied(true);
                      if (inviteCopyTimer.current) clearTimeout(inviteCopyTimer.current);
                      inviteCopyTimer.current = setTimeout(() => setInviteCopied(false), 2200);
                    }}
                    style={[styles.inviteActionBtn, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}
                    accessibilityRole="button"
                    accessibilityLabel={inviteCopied ? "Invite link copied" : "Copy invite link"}
                    accessibilityLiveRegion="polite"
                  >
                    <Ionicons name={inviteCopied ? "checkmark" : "copy-outline"} size={17} color={inviteCopied ? colors.green : colors.primary} />
                    <Text style={[styles.inviteActionText, { color: inviteCopied ? colors.green : colors.primary }]}>{inviteCopied ? "Copied" : "Copy"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => Share.share({ message: `Join ${event.title}! ${planInviteUrl(event.inviteCode)}` })}
                    style={[styles.inviteActionBtn, { backgroundColor: colors.primary + "16", borderColor: colors.primary + "35" }]}
                    accessibilityRole="button"
                    accessibilityLabel="Share invite link"
                  >
                    <Ionicons name="share-outline" size={17} color={colors.primary} />
                    <Text style={[styles.inviteActionText, { color: colors.primary }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
                    <TouchableOpacity onPress={() => openUserProfile(u.id)} accessibilityLabel={`Open ${u.name}'s profile`}>
                      <UserAvatar initials={u.initials} color={u.color} imageUrl={u.profileImageUrl} size={30} />
                    </TouchableOpacity>
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
      {tab === "chat" && !isCancelled && <ChatComposer chat={chat} botPad={botPad} />}

      {/* ---- Add Food Item Modal ---- */}
      <Modal visible={foodModal} transparent animationType="fade" onRequestClose={() => setFoodModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
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
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
      </Modal>

      {/* ---- Add Task Modal ---- */}
      <Modal visible={taskModal} transparent animationType="fade" onRequestClose={() => setTaskModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
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
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
      </Modal>

      {/* ---- Add Expense Modal ---- */}
      <Modal visible={costModal} transparent animationType="slide" onRequestClose={() => setCostModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editingCostId ? "Edit expense" : "Add expense"}</Text>
            <Text style={[styles.modalHint, { color: colors.mutedForeground }]}>
              You paid. Choose how to split the bill.
            </Text>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
              <BillDetailsFields form={bill} />

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
                    Even
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={switchToWeighted}
                  style={[styles.splitToggleBtn, splitMode === "weighted" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "weighted" ? "#fff" : colors.mutedForeground }]}>
                    By shares
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={switchToManual}
                  style={[styles.splitToggleBtn, splitMode === "manual" && { backgroundColor: colors.primary }]}
                >
                  <Text style={[styles.splitToggleText, { color: splitMode === "manual" ? "#fff" : colors.mutedForeground }]}>
                    Manual
                  </Text>
                </TouchableOpacity>
              </View>
              {splitMode === "weighted" && (
                <Text style={[styles.assignLabel, { color: colors.mutedForeground, marginTop: 6, textTransform: "none", letterSpacing: 0 }]}>
                  Enter shares or % — e.g. 2 and 1 = ⅔ and ⅓ of the bill.
                </Text>
              )}

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
                      ) : splitMode === "weighted" ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={[styles.assignInputWrap, { backgroundColor: colors.card, borderColor: colors.border, width: 64 }]}>
                            <TextInput
                              placeholder="1"
                              placeholderTextColor={colors.textDim}
                              value={costWeights[m.id] ?? ""}
                              onChangeText={(v) => setCostWeights((p) => ({ ...p, [m.id]: v }))}
                              keyboardType="decimal-pad"
                              style={[styles.assignInput, { color: colors.foreground }]}
                            />
                          </View>
                          <Text style={[styles.weightPreview, { color: totalWeight > 0 ? colors.mutedForeground : colors.textDim }]}>
                            {totalWeight > 0 ? `$${weightedShares[m.id] ?? "0.00"}` : "—"}
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
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
      </Modal>

      {/* ---- New Poll Modal ---- */}
      <Modal visible={pollModal} transparent animationType="slide" onRequestClose={() => setPollModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>New poll</Text>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
      </Modal>

      {/* ---- Edit Event Modal ---- */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
          <View style={[styles.modalCardLarge, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: botPad + 16 }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit event</Text>
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                    {editEndAt ? formatInstant(editEndAt) || formatEndLabel(editEndAt) : "Add an end time"}
                  </Text>
                </TouchableOpacity>
                {editEndAt ? (
                  <TouchableOpacity onPress={() => setEditEndAt(null)} hitSlop={8} style={{ paddingHorizontal: 4 }}>
                    <Ionicons name="close-circle" size={20} color={colors.textDim} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {zoneDiffers ? (
                <Text style={[styles.assignLabel, { color: colors.mutedForeground, marginTop: 4 }]}>
                  Your device is in {zoneLabel(deviceZone)}
                </Text>
              ) : null}
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/settings/timezone" as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Change display time zone, currently ${zoneLabel(timezone)}`}
                style={styles.timezoneControl}
              >
                <Ionicons name="globe-outline" size={13} color={colors.mutedForeground} />
                <Text style={[styles.timezoneControlText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  Showing times in {zoneLabel(timezone)}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={colors.textDim} />
              </TouchableOpacity>
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
                  minimumDate={endPickerMinimum}
                  onChange={(_, d) => { if (d) setEndPickerDate(d); }}
                  themeVariant="dark"
                  style={{ width: "100%", height: 200 }}
                />
              </View>
            </View>
          )}
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
      </Modal>

      {/* Android end-time picker (native dialog — safe outside the modal) */}
      {Platform.OS === "android" && endPickerStep !== null && (
        <DateTimePicker
          value={endPickerDate}
          mode={endPickerStep}
          display="default"
          minimumDate={endPickerMinimum}
          onChange={handleEndAndroidChange}
        />
      )}

      {/* ---- Budget Modal ---- */}
      <Modal visible={budgetModal} transparent animationType="fade" onRequestClose={() => setBudgetModal(false)}>
        <KeyboardAvoidingSheet style={styles.modalOverlay}>
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
        </KeyboardAvoidingSheet>
        <KeyboardDismissControl />
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
      <IdeaSheet
        visible={ideaSheetOpen}
        dayKeys={[]}
        isTrip={false}
        editing={editingIdea}
        saving={ideaBusy}
        onClose={() => setIdeaSheetOpen(false)}
        onSubmit={submitIdea}
      />

      <FriendPickerSheet
        visible={showInvitePicker}
        title="Invite friends"
        confirmLabel="Invite"
        allowNonFriends
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
  hero: { backgroundColor: "#FF6B2C", paddingHorizontal: 16, paddingBottom: 14, position: "relative" },
  backBtn: { position: "absolute", top: 0, left: 10, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  shareBtn: { position: "absolute", top: 0, right: 10, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
  gearBtn: { position: "absolute", top: 0, right: 50, width: 44, height: 44, alignItems: "center", justifyContent: "center", zIndex: 10 },
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
  heroSummary: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 48, marginBottom: 10 },
  heroSummaryBody: { flex: 1, minWidth: 0, gap: 3 },
  heroEmoji: { fontSize: 38, lineHeight: 44, width: 48, textAlign: "center" },
  heroTitleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, alignSelf: "flex-start" },
  heroTitle: { flexShrink: 1, fontSize: 21, lineHeight: 25, fontWeight: "800", color: "#fff" },
  heroHostBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  heroHostText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  heroMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 6, paddingHorizontal: 4, minHeight: 20, alignSelf: "flex-start", maxWidth: "100%" },
  heroDate: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.9)", fontWeight: "600" },
  heroLocation: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: "rgba(255,255,255,0.9)" },
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    marginBottom: 10,
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
  rsvpBtn: { flex: 1, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 20, borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 8 },
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
  inviteCard: { paddingVertical: 12 },
  inviteHeadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  inviteTextColumn: { flex: 1, minWidth: 0, gap: 3 },
  inviteCode: { fontSize: 15, lineHeight: 20, fontWeight: "800", letterSpacing: 0.8 },
  inviteActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  inviteActionBtn: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12, borderWidth: 1, paddingHorizontal: 9 },
  inviteActionText: { fontSize: 12, fontWeight: "700" },
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
  modalCard: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 12, maxHeight: "92%" },
  modalCardLarge: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, padding: 20, gap: 10, maxHeight: "92%" },
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
  timezoneControl: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingVertical: 8 },
  timezoneControlText: { fontSize: 12, fontWeight: "600" },
  endPickText: { flex: 1, fontSize: 15, fontWeight: "600" },
  endPickerOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", zIndex: 50 },
  endPickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  endPickerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  assignRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 10, borderWidth: 1, borderColor: "transparent" },
  assignName: { flex: 1, fontSize: 14, fontWeight: "600" },
  participantCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  assignInputWrap: { flexDirection: "row", alignItems: "center", gap: 2, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, width: 100, height: 40 },
  assignInput: { flex: 1, fontSize: 14, fontWeight: "700", height: "100%" },
  weightPreview: { fontSize: 13, fontWeight: "700", minWidth: 54, textAlign: "right" },
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
