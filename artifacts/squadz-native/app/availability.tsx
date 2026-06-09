import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  Image,
  Animated,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  AppState,
  type AppStateStatus,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useInteractionGuard, useModalGuard } from "@/hooks/useInteractionGuard";
import { useAuth } from "@/context/AppContext";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { GradientButton } from "@/components/GradientButton";

const DAY_COUNT_OPTIONS = [3, 5, 7, 14, 21, 30];
// How many day-columns are shown in the grid at once. Larger ranges page
// through these windows with prev/next arrows instead of cramming every day
// onto one screen.
const DAY_WINDOW = 5;
const DEFAULT_DAY_COUNT = 7;
const ALL_SLOT_OPTIONS: string[] = ["6AM","7AM","8AM","9AM","10AM","11AM","12PM","1PM","2PM","3PM","4PM","5PM","6PM","7PM","8PM","9PM","10PM"];
const DEFAULT_SLOTS: string[] = ["6PM","7PM","8PM","9PM","10PM"];

const DAY_FULL: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type MemberInfo = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  hasResponded: boolean;
  needsUpdate: boolean;
  respondedAt: string | null;
  nudgedAt?: string | null;
};

type PollPayload = {
  poll: {
    id: string;
    createdBy: string;
    title: string;
    days: string[];
    slots: string[];
    updatedAt: string | null;
    updatedBy: string | null;
    updatedByName: string | null;
  };
  heatmap: { cell: string; count: number }[];
  cellUsers?: Record<string, string[]>;
  respondentCount: number;
  myCells: string[];
  myResponseUpdatedAt: string | null;
  memberCells?: { userId: string; cells: string[] }[];
  best: { cell: string; count: number; total: number } | null;
  members?: MemberInfo[];
  droppedCount?: number;
  nudgedAt?: string | null;
};

// Split a cell key `${day}-${slot}` on the LAST dash so ISO dates (which
// contain dashes, e.g. "2026-06-14") keep their slot intact.
function splitCell(cell: string): { day: string; slot: string } {
  const i = cell.lastIndexOf("-");
  if (i < 0) return { day: cell, slot: "" };
  return { day: cell.slice(0, i), slot: cell.slice(i + 1) };
}

function parseISODate(day: string): Date | null {
  const m = ISO_DATE.exec(day);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

// Build `count` consecutive ISO date strings starting at `start`.
function computeRange(start: Date, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
  }
  return out;
}

// "7PM" -> "7 PM"; pass anything else through unchanged.
function formatSlot(slot: string): string {
  const m = /^(\d{1,2})\s*(AM|PM)$/i.exec(slot);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : slot;
}

// Format an ISO timestamp into a compact "Jun 7" or "Jun 7, 2025" label.
function formatUpdatedDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = MONTH_SHORT[d.getMonth()];
  const day = d.getDate();
  return sameYear ? `${month} ${day}` : `${month} ${day}, ${d.getFullYear()}`;
}

// Column header label for a poll day. Dated polls show weekday + M/D
// (e.g. "Sat" / "6/14"); legacy weekday polls show the weekday label.
function dayHeader(day: string): { top: string; sub: string } {
  const d = parseISODate(day);
  if (!d) return { top: day, sub: "" };
  return {
    top: WEEKDAY_SHORT[d.getDay()],
    sub: `${d.getMonth() + 1}/${d.getDate()}`,
  };
}

// Human-friendly day label. Dated -> "Sat Jun 14"; legacy -> "Monday".
function prettyDay(day: string): string {
  const d = parseISODate(day);
  if (!d) return DAY_FULL[day] ?? day;
  return `${WEEKDAY_SHORT[d.getDay()]} ${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// Full label for a chosen cell, e.g. "Sat Jun 14 · 7 PM" (dated) or
// "Monday 8 PM" (legacy weekday).
function prettyCell(cell: string | null): string {
  if (!cell) return "";
  const { day, slot } = splitCell(cell);
  const isDate = parseISODate(day) !== null;
  const slotPretty = formatSlot(slot);
  const dayPretty = prettyDay(day);
  if (!slotPretty) return dayPretty;
  return isDate ? `${dayPretty} · ${slotPretty}` : `${dayPretty} ${slotPretty}`;
}

export default function AvailabilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { authToken, currentUser } = useAuth();
  const params = useLocalSearchParams<{ squadId?: string; eventId?: string; from?: string }>();
  const squadId = params.squadId || undefined;
  const eventId = params.eventId || undefined;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PollPayload | null>(null);
  const [mySet, setMySet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [droppedNotice, setDroppedNotice] = useState<string | null>(null);
  const droppedOpacity = useRef(new Animated.Value(0)).current;
  const droppedAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const [rangeUpdatedBanner, setRangeUpdatedBanner] = useState(false);
  const [rangeUpdatedVisible, setRangeUpdatedVisible] = useState(false);
  const rangeUpdatedOpacity = useRef(new Animated.Value(0)).current;

  // Setup state: shown when no poll exists yet so the creator can pick the
  // availability range (start date + number of days) before it's created.
  const [needsSetup, setNeedsSetup] = useState(false);
  // Index of the first day column currently shown in the paged grid.
  const [dayWindowStart, setDayWindowStart] = useState(0);
  const [creating, setCreating] = useState(false);
  const [pollTitle, setPollTitle] = useState("");
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_DAY_COUNT);
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set(DEFAULT_SLOTS));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  // Tracks the poll's updatedAt that the user has already dismissed, so a
  // background refresh doesn't resurrect a banner they already saw/dismissed.
  const dismissedRangeUpdateRef = useRef<string | null>(null);

  // "New responses" banner state — shown to the host when members responded
  // since the host last opened the poll. Cleared immediately once they open it
  // (the timestamp is persisted to AsyncStorage on each load).
  const [newResponseCount, setNewResponseCount] = useState(0);
  const [newResponseBannerVisible, setNewResponseBannerVisible] = useState(false);
  const newResponseBannerOpacity = useRef(new Animated.Value(0)).current;

  // Keep a ref that always reflects the latest `dirty` value so the polling
  // interval callback doesn't capture a stale closure.
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Intercept all back-navigation (header button, Android hardware back, iOS
  // swipe-back) when there are unsaved availability changes.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (e: {
      preventDefault: () => void;
      data: { action: object };
    }) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      Alert.alert(
        "Unsaved changes",
        "You have unsaved availability — leave anyway?",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => (navigation as { dispatch: (action: object) => void }).dispatch(e.data.action),
          },
        ],
      );
    });
    return unsubscribe;
  }, [navigation]);

  // Keep a ref that tells background polling whether a real poll is loaded.
  const hasPollRef = useRef(false);
  useEffect(() => { hasPollRef.current = data !== null; }, [data]);

  // Shared guard — any modal/sheet calls hold() when it opens and release()
  // when it closes; cell taps call stamp().  refreshInBackground uses
  // isActive() to skip fetches while the user is interacting.
  const { stamp: stampInteraction, hold: holdInteraction, release: releaseInteraction, isActive: interactionActive } =
    useInteractionGuard();

  // While the iOS date-picker sheet is open the user may spin the spinner for
  // many seconds — far longer than INTERACTION_QUIET_MS.  Delegate to the
  // shared guard so the quiet window holds for the full duration the sheet is
  // visible and releases naturally when the sheet closes.
  useModalGuard(pickerOpen, holdInteraction, releaseInteraction);

  // Live indicator: timestamp of last successful background refresh.
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  // Ticks every 30 s to keep the "Updated X ago" label fresh.
  const [, setTick] = useState(0);
  // True for INTERACTION_QUIET_MS after the last cell tap — hides the badge.
  const [isInQuietWindow, setIsInQuietWindow] = useState(false);
  const quietWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Which respondents' times are being highlighted (empty = normal heatmap view).
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  // Pending modal — shown when user taps the "N still pending" label.
  const [showPendingModal, setShowPendingModal] = useState(false);

  // Response timeline — host-only collapsible list of all members + timestamps.
  const [showTimeline, setShowTimeline] = useState(false);

  // Cell detail sheet — shown when user taps a heatmap cell.
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  // Which avatar is showing its name tooltip (auto-dismisses after 2 s).
  const [tooltipMemberId, setTooltipMemberId] = useState<string | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipOpacity = useRef(new Animated.Value(0)).current;
  const tooltipAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const showTooltip = useCallback((memberId: string) => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (tooltipAnimRef.current) tooltipAnimRef.current.stop();
    setTooltipMemberId(memberId);
    tooltipAnimRef.current = Animated.timing(tooltipOpacity, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    });
    tooltipAnimRef.current.start();
    tooltipTimerRef.current = setTimeout(() => {
      tooltipAnimRef.current = Animated.timing(tooltipOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      });
      tooltipAnimRef.current.start(({ finished }) => {
        if (finished) setTooltipMemberId(null);
      });
    }, 2000);
  }, [tooltipOpacity]);

  const clearTooltip = useCallback(() => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (tooltipAnimRef.current) tooltipAnimRef.current.stop();
    tooltipAnimRef.current = Animated.timing(tooltipOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    });
    tooltipAnimRef.current.start(({ finished }) => {
      if (finished) setTooltipMemberId(null);
    });
  }, [tooltipOpacity]);

  // Nudge state: tracks per-member button state for the poll creator.
  // 'sending' = in-flight, 'sent' = recently sent (debounce UI), null = idle.
  const [nudgeState, setNudgeState] = useState<Map<string, "sending" | "sent">>(new Map());
  // Banner shown to a member who was nudged to fill in their availability.
  const [nudgedBanner, setNudgedBanner] = useState<string | null>(null);

  // Edit range state: host-only modal to update an existing poll's date range and title.
  const [editRangeOpen, setEditRangeOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState<Date>(new Date());
  const [editDays, setEditDays] = useState<number>(DEFAULT_DAY_COUNT);
  const [editSlots, setEditSlots] = useState<Set<string>>(new Set(DEFAULT_SLOTS));
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  const [editPickerDate, setEditPickerDate] = useState<Date>(new Date());
  const [updating, setUpdating] = useState(false);

  // Guard the entire edit-range flow: hold while the sheet or its nested
  // date-picker is open; release only when both are closed.  The combined
  // boolean ensures closing the inner picker while the sheet remains open
  // does not prematurely release the guard.
  useModalGuard(editRangeOpen || editPickerOpen || showPendingModal, holdInteraction, releaseInteraction);

  // Fade the droppedNotice banner in when it appears.
  useEffect(() => {
    if (droppedNotice !== null) {
      if (droppedAnimRef.current) droppedAnimRef.current.stop();
      droppedOpacity.setValue(0);
      droppedAnimRef.current = Animated.timing(droppedOpacity, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      });
      droppedAnimRef.current.start();
    }
  }, [droppedNotice, droppedOpacity]);

  // Fade the rangeUpdatedBanner in/out.
  useEffect(() => {
    if (rangeUpdatedBanner) {
      setRangeUpdatedVisible(true);
      Animated.timing(rangeUpdatedOpacity, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(rangeUpdatedOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRangeUpdatedVisible(false);
      });
    }
  }, [rangeUpdatedBanner, rangeUpdatedOpacity]);

  // Fade the newResponsesBanner in/out.
  useEffect(() => {
    if (newResponseCount > 0) {
      setNewResponseBannerVisible(true);
      Animated.timing(newResponseBannerOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(newResponseBannerOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setNewResponseBannerVisible(false);
      });
    }
  }, [newResponseCount, newResponseBannerOpacity]);

  // "Updated just now" indicator — fades in on data change, out after ~3s.
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeOutAnim = useRef<Animated.CompositeAnimation | null>(null);

  const showUpdateIndicator = useCallback(() => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (fadeOutAnim.current) fadeOutAnim.current.stop();
    fadeAnim.setValue(1);
    fadeTimerRef.current = setTimeout(() => {
      fadeOutAnim.current = Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 700,
        useNativeDriver: true,
      });
      fadeOutAnim.current.start();
    }, 2300);
  }, [fadeAnim]);

  const authHeaders = useCallback((): Record<string, string> => {
    return {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authToken),
    };
  }, [authToken]);

  const loadPoll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNeedsSetup(false);

    // Read the last-viewed timestamp BEFORE fetching so we can compare once
    // the payload arrives. Keyed by the squad/event so different polls don't
    // share a timestamp.
    const avKey = `availability_lastviewed_${squadId ?? eventId}`;
    let lastViewedAt: Date | null = null;
    try {
      const stored = await AsyncStorage.getItem(avKey);
      if (stored) lastViewedAt = new Date(Number(stored));
    } catch { /* ignore */ }

    try {
      const qs = new URLSearchParams(squadId ? { squadId } : { eventId: eventId ?? "" });
      const res = await fetch(`${API_BASE}/api/availability/polls/find?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.status === 404) {
        // No poll yet — let the creator choose the date range.
        setData(null);
        setNeedsSetup(true);
        // Mark this "visit" so the next open uses now as baseline.
        try { await AsyncStorage.setItem(avKey, String(Date.now())); } catch { /* ignore */ }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not load availability.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
      // Show the "range updated" banner for non-creators when the host has
      // updated the date range more recently than the member last responded.
      if (payload.poll.updatedAt && payload.poll.createdBy !== currentUser?.id) {
        const rangeTs = payload.poll.updatedAt;
        const responseTs = payload.myResponseUpdatedAt;
        const shouldShow =
          dismissedRangeUpdateRef.current !== rangeTs &&
          (responseTs === null || new Date(rangeTs) > new Date(responseTs));
        setRangeUpdatedBanner(shouldShow);
      } else {
        setRangeUpdatedBanner(false);
      }

      // Show "new responses" banner when the viewer IS the host and members
      // have responded since the host's last visit.
      if (payload.poll.createdBy === currentUser?.id && lastViewedAt !== null) {
        const count = (payload.members ?? []).filter((m) => {
          if (m.id === currentUser.id) return false;
          if (!m.respondedAt) return false;
          return new Date(m.respondedAt) > lastViewedAt!;
        }).length;
        setNewResponseCount(count);
      } else {
        setNewResponseCount(0);
      }

      // Record this view so the next open uses now as the baseline.
      try { await AsyncStorage.setItem(avKey, String(Date.now())); } catch { /* ignore */ }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, squadId, eventId, currentUser]);

  const createPoll = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      const days = computeRange(rangeStart, rangeDays);
      const slots = ALL_SLOT_OPTIONS.filter(s => selectedSlots.has(s));
      const body: Record<string, unknown> = { ...(squadId ? { squadId } : { eventId }), days, slots };
      if (pollTitle.trim()) body.title = pollTitle.trim();
      const res = await fetch(`${API_BASE}/api/availability/polls`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't create poll", body.error ?? "Please try again.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setNeedsSetup(false);
      setDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't create poll", "Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [authHeaders, squadId, eventId, pollTitle, rangeStart, rangeDays]);

  // Silently re-fetches the poll and updates the heatmap + best-time card.
  // The user's own unsaved picks (mySet) are only synced when there are no
  // pending changes so we never clobber work in progress.
  // Skips the fetch entirely if the user tapped a cell within the last 4 s to
  // avoid redrawing the heatmap underneath an active selection.
  const INTERACTION_QUIET_MS = 4_000;
  const refreshInBackground = useCallback(async () => {
    if (!hasPollRef.current) return;
    if (interactionActive(INTERACTION_QUIET_MS)) return;
    try {
      const qs = new URLSearchParams(squadId ? { squadId } : { eventId: eventId ?? "" });
      const res = await fetch(`${API_BASE}/api/availability/polls/find?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const payload = (await res.json()) as PollPayload;
      setData((prev) => {
        const changed =
          !prev ||
          prev.respondentCount !== payload.respondentCount ||
          JSON.stringify(prev.heatmap) !== JSON.stringify(payload.heatmap);
        if (changed) showUpdateIndicator();
        return payload;
      });
      if (!dirtyRef.current) {
        setMySet(new Set(payload.myCells));
      }
      setLastRefreshed(new Date());
      // Re-evaluate the banner on every background refresh so members are
      // notified even if the host updates the range while they're on screen.
      if (payload.poll.updatedAt && payload.poll.createdBy !== currentUser?.id) {
        const rangeTs = payload.poll.updatedAt;
        const responseTs = payload.myResponseUpdatedAt;
        const shouldShow =
          dismissedRangeUpdateRef.current !== rangeTs &&
          (responseTs === null || new Date(rangeTs) > new Date(responseTs));
        setRangeUpdatedBanner(shouldShow);
      } else {
        setRangeUpdatedBanner(false);
      }
    } catch {
      // Ignore network errors during background refresh — never surface them
    }
  }, [authHeaders, squadId, eventId, showUpdateIndicator, currentUser]);

  // Set up a 20-second polling interval while the screen is mounted, and also
  // trigger an immediate refresh when the app returns to the foreground.
  useEffect(() => {
    const POLL_MS = 20_000;
    const intervalId = setInterval(() => { void refreshInBackground(); }, POLL_MS);

    const handleAppState = (next: AppStateStatus) => {
      if (next === "active") void refreshInBackground();
    };
    const sub = AppState.addEventListener("change", handleAppState);

    return () => {
      clearInterval(intervalId);
      sub.remove();
    };
  }, [refreshInBackground]);

  // Re-fetch silently whenever the screen gains focus so that slots submitted
  // by other squad members in a different session are visible immediately on
  // return, without waiting for the next 20-second polling tick.
  useFocusEffect(
    useCallback(() => {
      void refreshInBackground();
    }, [refreshInBackground]),
  );

  // Tick every 30 s so the "Updated X ago" label stays current.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const openEditRange = useCallback(() => {
    if (!data) return;
    // Pre-populate with the poll's current range and title so the host sees what's set.
    const firstDay = data.poll.days[0];
    const d = parseISODate(firstDay);
    setEditStart(d ?? new Date());
    setEditDays(data.poll.days.length);
    setEditSlots(new Set((data.poll.slots as string[]) ?? DEFAULT_SLOTS));
    setEditTitle(data.poll.title ?? "");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditRangeOpen(true);
  }, [data]);

  const updateRange = useCallback(async () => {
    if (!data) return;
    setUpdating(true);
    try {
      const days = computeRange(editStart, editDays);
      const slots = ALL_SLOT_OPTIONS.filter(s => editSlots.has(s));
      const patchBody: Record<string, unknown> = { days, ...(slots.length > 0 ? { slots } : {}) };
      patchBody.title = editTitle.trim();
      const res = await fetch(`${API_BASE}/api/availability/polls/${data.poll.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't update range", body.error ?? "Please try again.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      setData(payload);
      setMySet(new Set(payload.myCells));
      setDirty(false);
      setEditRangeOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't update range", "Network error. Please try again.");
    } finally {
      setUpdating(false);
    }
  }, [data, authHeaders, editTitle, editStart, editDays, editSlots]);

  // When poll data arrives, pre-populate nudge button state from server-side
  // debounce info (nudgedAt per member) and surface the nudged banner if this
  // user was nudged recently and hasn't responded yet.
  useEffect(() => {
    if (!data) return;

    // Seed nudge button state from server-returned nudgedAt per member.
    const initial = new Map<string, "sending" | "sent">();
    for (const m of data.members ?? []) {
      if (m.nudgedAt && !m.hasResponded) {
        initial.set(m.id, "sent");
      }
    }
    setNudgeState(initial);

    // Show nudged banner if the server says the current user was nudged.
    if (data.nudgedAt && data.myCells.length === 0) {
      setNudgedBanner("Your squad creator nudged you to fill in your availability!");
    }
  }, [data]);

  useEffect(() => {
    if (!squadId && !eventId) {
      setError("Missing squad or event.");
      setLoading(false);
      return;
    }
    void loadPoll();
  }, [loadPoll, squadId, eventId]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    data?.heatmap.forEach((c) => m.set(c.cell, c.count));
    return m;
  }, [data]);

  const memberMap = useMemo(() => {
    const m = new Map<string, MemberInfo>();
    data?.members?.forEach((mem) => m.set(mem.id, mem));
    return m;
  }, [data]);

  // Intersection of cells where ALL selected respondents are free.
  const selectedMemberCellSet = useMemo<Set<string>>(() => {
    if (selectedMemberIds.size === 0 || !data?.memberCells) return new Set();
    const entries = data.memberCells.filter((mc) => selectedMemberIds.has(mc.userId));
    if (entries.length === 0) return new Set();
    const sets = entries.map((e) => new Set(e.cells));
    const result = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      for (const cell of result) {
        if (!sets[i].has(cell)) result.delete(cell);
      }
    }
    return result;
  }, [selectedMemberIds, data]);

  const toggleCell = (cell: string) => {
    stampInteraction();
    // Suppress the live badge while the user is actively tapping cells.
    setIsInQuietWindow(true);
    if (quietWindowTimerRef.current) clearTimeout(quietWindowTimerRef.current);
    quietWindowTimerRef.current = setTimeout(() => setIsInQuietWindow(false), INTERACTION_QUIET_MS);
    Haptics.selectionAsync();
    setMySet((prev) => {
      const next = new Set(prev);
      if (next.has(cell)) next.delete(cell);
      else next.add(cell);
      return next;
    });
    setDirty(true);
  };

  const openCellSheet = (cell: string) => {
    stampInteraction();
    setIsInQuietWindow(true);
    if (quietWindowTimerRef.current) clearTimeout(quietWindowTimerRef.current);
    quietWindowTimerRef.current = setTimeout(() => setIsInQuietWindow(false), INTERACTION_QUIET_MS);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    holdInteraction();
    setSelectedCell(cell);
  };

  const closeCellSheet = () => {
    setSelectedCell(null);
    releaseInteraction();
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    // Snapshot the current grid so we can detect if it changed server-side.
    const prevDays = data.poll.days;
    const prevSlots = data.poll.slots;
    try {
      const res = await fetch(`${API_BASE}/api/availability/polls/${data.poll.id}/me`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ cells: [...mySet] }),
      });
      if (!res.ok) {
        Alert.alert("Couldn't save", "Please try again.");
        return;
      }
      const payload = (await res.json()) as PollPayload;
      const dropped = payload.droppedCount ?? 0;

      if (dropped > 0) {
        // Detect whether the poll's grid itself changed (dates recreated / range shifted).
        const gridChanged =
          payload.poll.days.length !== prevDays.length ||
          payload.poll.slots.length !== prevSlots.length ||
          payload.poll.days.some((d, i) => d !== prevDays[i]) ||
          payload.poll.slots.some((s, i) => s !== prevSlots[i]);

        if (gridChanged) {
          // Re-fetch via the find endpoint to guarantee the grid is fully in
          // sync with the current server state (the PUT payload is sufficient
          // but a fresh GET confirms nothing else changed concurrently).
          let refreshed: PollPayload = payload;
          try {
            const qs = new URLSearchParams(squadId ? { squadId } : { eventId: eventId ?? "" });
            const refreshRes = await fetch(`${API_BASE}/api/availability/polls/find?${qs.toString()}`, {
              headers: authHeaders(),
            });
            if (refreshRes.ok) {
              refreshed = (await refreshRes.json()) as PollPayload;
            }
          } catch {
            // Fall back to the PUT response if the refresh request fails.
          }
          setData(refreshed);
          setMySet(new Set(refreshed.myCells));
          setDroppedNotice(
            `The poll's dates changed — the grid has been updated. ${dropped} ${dropped === 1 ? "selection was" : "selections were"} outside the new range and couldn't be saved.`,
          );
        } else {
          setData(payload);
          setMySet(new Set(payload.myCells));
          setDroppedNotice(
            `${dropped} picked ${dropped === 1 ? "time was" : "times were"} outside the poll's range and couldn't be saved.`,
          );
        }
        setDirty(false);
        setTimeout(() => {
          if (droppedAnimRef.current) droppedAnimRef.current.stop();
          droppedAnimRef.current = Animated.timing(droppedOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          });
          droppedAnimRef.current.start(({ finished }) => {
            if (finished) setDroppedNotice(null);
          });
        }, 5800);
      } else {
        setData(payload);
        setMySet(new Set(payload.myCells));
        setDirty(false);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // User just submitted their availability — clear the range-updated banner.
      setRangeUpdatedBanner(false);
    } catch {
      Alert.alert("Couldn't save", "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const useThisTime = async () => {
    if (!data?.best) return;
    const friendly = prettyCell(data.best.cell);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (eventId) {
      try {
        const res = await fetch(`${API_BASE}/api/events/${eventId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ date: friendly }),
        });
        if (res.ok) {
          Alert.alert("Time locked in", `${friendly} is now the event time.`, [
            { text: "Done", onPress: () => router.back() },
          ]);
        } else if (res.status === 403) {
          Alert.alert("Host only", "Only the event host can change the time.");
        } else {
          Alert.alert("Couldn't update", "Please try again.");
        }
      } catch {
        Alert.alert("Couldn't update", "Network error. Please try again.");
      }
      return;
    }
    // Squad / create flow → start an event prefilled with the winning slot.
    router.push({
      pathname: "/create",
      params: { prefillDate: friendly, prefillSquad: squadId ?? "" },
    } as never);
  };

  const openRangePicker = () => {
    stampInteraction();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerDate(rangeStart);
    setPickerOpen(true);
  };

  const handleAndroidPick = (_: DateTimePickerEvent, d?: Date) => {
    setPickerOpen(false);
    if (d) setRangeStart(d);
  };

  const confirmIOSPick = () => {
    setRangeStart(pickerDate);
    setPickerOpen(false);
  };

  const rangePreview = useMemo(() => {
    const days = computeRange(rangeStart, rangeDays);
    const first = days[0];
    const last = days[days.length - 1];
    return `${prettyDay(first)} – ${prettyDay(last)}`;
  }, [rangeStart, rangeDays]);

  const editRangePreview = useMemo(() => {
    const days = computeRange(editStart, editDays);
    const first = days[0];
    const last = days[days.length - 1];
    return `${prettyDay(first)} – ${prettyDay(last)}`;
  }, [editStart, editDays]);

  const sendNudge = useCallback(async (targetUserId: string) => {
    if (!data) return;
    setNudgeState((prev) => new Map(prev).set(targetUserId, "sending"));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const res = await fetch(`${API_BASE}/api/availability/polls/${data.poll.id}/nudge`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ targetUserId }),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { retryAfterSec?: number };
        const waitMin = body.retryAfterSec ? Math.ceil(body.retryAfterSec / 60) : 5;
        Alert.alert("Already nudged", `Please wait about ${waitMin} minute${waitMin !== 1 ? "s" : ""} before nudging again.`);
        setNudgeState((prev) => {
          const next = new Map(prev);
          next.delete(targetUserId);
          return next;
        });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        Alert.alert("Couldn't nudge", body.error ?? "Please try again.");
        setNudgeState((prev) => {
          const next = new Map(prev);
          next.delete(targetUserId);
          return next;
        });
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNudgeState((prev) => new Map(prev).set(targetUserId, "sent"));
    } catch {
      Alert.alert("Couldn't nudge", "Network error. Please try again.");
      setNudgeState((prev) => {
        const next = new Map(prev);
        next.delete(targetUserId);
        return next;
      });
    }
  }, [data, authHeaders]);

  const isCreator = data?.poll.createdBy === currentUser?.id;

  const total = data?.respondentCount ?? 0;

  const cellStyle = (cell: string) => {
    const c = counts.get(cell) ?? 0;
    const mine = mySet.has(cell);
    let bg = colors.card;
    if (total > 0 && c > 0) {
      const intensity = c / total;
      const alpha = intensity >= 1 ? "FF" : intensity >= 0.66 ? "AA" : intensity >= 0.33 ? "66" : "33";
      bg = colors.primary + alpha;
    }

    // When members are selected, highlight cells where ALL are free and dim the rest.
    if (selectedMemberIds.size > 0) {
      const memberFree = selectedMemberCellSet.has(cell);
      return {
        backgroundColor: bg,
        borderColor: memberFree ? "#F59E0B" : colors.border,
        borderWidth: memberFree ? 2.5 : 1,
        opacity: memberFree ? 1 : 0.35,
      };
    }

    return {
      backgroundColor: bg,
      borderColor: mine ? colors.foreground : colors.border,
      borderWidth: mine ? 2 : 1,
    };
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {(data?.poll.title) || "Find the Best Time"}
          </Text>
          {data?.poll.updatedAt && data.poll.updatedByName ? (
            <Text style={[styles.renamedByText, { color: colors.mutedForeground }]} numberOfLines={1}>
              Renamed by {data.poll.updatedByName} · {formatUpdatedDate(data.poll.updatedAt)}
            </Text>
          ) : null}
        </View>
        {isCreator && (
          <TouchableOpacity onPress={openEditRange} style={styles.editRangeBtn}>
            <Ionicons name="calendar-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textDim} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          <TouchableOpacity onPress={() => void loadPoll()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : needsSetup ? (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: botPad + 120, paddingHorizontal: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heroWrap}>
              <LinearGradient
                colors={["#FF5C3A", "#FF8050"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.setupHeroCard}
              >
                <View style={styles.heroIcon}>
                  <Ionicons name="sparkles" size={22} color="#fff" />
                </View>
                <Text style={styles.setupHeroTitle}>Find the time that works for everyone</Text>
                <Text style={styles.setupHeroSub}>
                  Set a date range, everyone taps when they're free, and we surface the best time automatically.
                </Text>
              </LinearGradient>
            </View>

            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Pick the dates everyone should mark their availability for. You can plan for this week or further out.
            </Text>

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Poll title (optional)</Text>
            <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="text-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                value={pollTitle}
                onChangeText={setPollTitle}
                placeholder="e.g. Summer trip dates"
                placeholderTextColor={colors.textDim}
                maxLength={120}
                style={[styles.dateBtnText, { color: colors.foreground }]}
              />
            </View>

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Start date</Text>
            {Platform.OS === "web" ? (
              <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <TextInput
                  value={toISODate(rangeStart)}
                  onChangeText={(t) => {
                    const d = parseISODate(t.trim());
                    if (d) setRangeStart(d);
                  }}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textDim}
                  style={[styles.dateBtnText, { color: colors.foreground }]}
                />
              </View>
            ) : (
              <TouchableOpacity
                onPress={openRangePicker}
                style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
              >
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <Text style={[styles.dateBtnText, { color: colors.foreground }]}>{prettyDay(toISODate(rangeStart))}</Text>
                <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>How many days?</Text>
            <View style={styles.chipRow}>
              {DAY_COUNT_OPTIONS.map((n) => {
                const active = rangeDays === n;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => {
                      stampInteraction();
                      Haptics.selectionAsync();
                      setRangeDays(n);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{n} days</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Time slots</Text>
            <View style={styles.chipRow}>
              {ALL_SLOT_OPTIONS.map((s) => {
                const active = selectedSlots.has(s);
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => {
                      stampInteraction();
                      Haptics.selectionAsync();
                      setSelectedSlots((prev) => {
                        const next = new Set(prev);
                        if (next.has(s)) {
                          if (next.size > 1) next.delete(s);
                        } else {
                          next.add(s);
                        }
                        return next;
                      });
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={[styles.previewText, { color: colors.foreground }]}>{rangePreview}</Text>
            </View>
          </ScrollView>

          <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
            <GradientButton
              label={creating ? "Creating…" : "Create poll"}
              onPress={() => void createPoll()}
              disabled={creating}
            />
          </View>

          {Platform.OS === "ios" && pickerOpen && (
            <Modal visible animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
              <View style={styles.pickerOverlay}>
                <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
                  <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                    <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.pickerBtn}>
                      <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Start Date</Text>
                    <TouchableOpacity onPress={confirmIOSPick} style={styles.pickerBtn}>
                      <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={pickerDate}
                    mode="date"
                    display="spinner"
                    onChange={(_, d) => { if (d) setPickerDate(d); }}
                    minimumDate={new Date()}
                    themeVariant="dark"
                    style={{ width: "100%", height: 200 }}
                  />
                </View>
              </View>
            </Modal>
          )}

          {Platform.OS === "android" && pickerOpen && (
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display="default"
              onChange={handleAndroidPick}
              minimumDate={new Date()}
            />
          )}
        </>
      ) : data ? (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: botPad + 140, paddingHorizontal: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Tap the times you're free. We'll highlight when the most people can make it.
            </Text>

            {rangeUpdatedVisible && (
              <Animated.View style={[styles.rangeUpdatedBanner, { backgroundColor: colors.card, borderColor: colors.primary + "66", opacity: rangeUpdatedOpacity }]}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} style={{ marginTop: 1 }} />
                <Text style={[styles.rangeUpdatedText, { color: colors.foreground }]}>
                  The host updated the date range — please re-enter your availability
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    dismissedRangeUpdateRef.current = data.poll.updatedAt;
                    setRangeUpdatedBanner(false);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </Animated.View>
            )}

            {newResponseBannerVisible && (
              <Animated.View style={[styles.newResponseBanner, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "55", opacity: newResponseBannerOpacity }]}>
                <View style={[styles.newResponseBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.newResponseBadgeText}>{newResponseCount}</Text>
                </View>
                <Text style={[styles.newResponseText, { color: colors.foreground }]}>
                  {newResponseCount === 1
                    ? "1 new availability response since your last visit"
                    : `${newResponseCount} new availability responses since your last visit`}
                </Text>
                <TouchableOpacity
                  onPress={() => setNewResponseCount(0)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </Animated.View>
            )}

            {data.best && (
              <View style={styles.heroWrap}>
                <LinearGradient
                  colors={["#FF5C3A", "#FF8050"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroCard}
                >
                  <View style={styles.heroIcon}>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroLabel}>BEST TIME FOR EVERYONE</Text>
                    <Text style={styles.heroValue} numberOfLines={2}>{prettyCell(data.best.cell)}</Text>
                  </View>
                  <View style={styles.heroFreePill}>
                    <Text style={styles.heroFreeCount}>{data.best.count}/{data.best.total}</Text>
                    <Text style={styles.heroFreeLabel}>free</Text>
                  </View>
                </LinearGradient>
              </View>
            )}

            {/* Grid */}
            <View style={styles.gridWrap}>
              {lastRefreshed && !isInQuietWindow && (
                <View style={styles.liveRow}>
                  <View style={[styles.liveDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.liveText, { color: colors.mutedForeground }]}>
                    {(() => {
                      const diffS = Math.floor((Date.now() - lastRefreshed.getTime()) / 1000);
                      if (diffS < 60) return "Updated just now";
                      const diffM = Math.floor(diffS / 60);
                      return `Updated ${diffM}m ago`;
                    })()}
                  </Text>
                </View>
              )}
              {(() => {
                const allDays = data.poll.days;
                const maxStart = Math.max(0, allDays.length - DAY_WINDOW);
                const winStart = Math.min(dayWindowStart, maxStart);
                const visibleDays = allDays.slice(winStart, winStart + DAY_WINDOW);
                const showPager = allDays.length > DAY_WINDOW;
                return (
                  <>
                    {showPager && (
                      <View style={styles.pagerRow}>
                        <TouchableOpacity
                          onPress={() => { Haptics.selectionAsync(); setDayWindowStart(Math.max(0, winStart - DAY_WINDOW)); }}
                          disabled={winStart === 0}
                          style={[styles.pagerBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: winStart === 0 ? 0.4 : 1 }]}
                          hitSlop={8}
                        >
                          <Ionicons name="chevron-back" size={18} color={colors.foreground} />
                        </TouchableOpacity>
                        <View style={styles.pagerLabelWrap}>
                          <Text style={[styles.pagerLabel, { color: colors.foreground }]} numberOfLines={1}>
                            {prettyDay(visibleDays[0])}{visibleDays.length > 1 ? ` – ${prettyDay(visibleDays[visibleDays.length - 1])}` : ""}
                          </Text>
                          <Text style={[styles.pagerSub, { color: colors.textDim }]}>
                            Days {winStart + 1}–{winStart + visibleDays.length} of {allDays.length}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => { Haptics.selectionAsync(); setDayWindowStart(Math.min(maxStart, winStart + DAY_WINDOW)); }}
                          disabled={winStart >= maxStart}
                          style={[styles.pagerBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: winStart >= maxStart ? 0.4 : 1 }]}
                          hitSlop={8}
                        >
                          <Ionicons name="chevron-forward" size={18} color={colors.foreground} />
                        </TouchableOpacity>
                      </View>
                    )}
                    <View style={styles.gridHeaderRow}>
                      <View style={styles.timeLabelCol} />
                      {visibleDays.map((d) => {
                        const h = dayHeader(d);
                  return (
                    <View key={d} style={styles.dayHeaderCol}>
                      <Text style={[styles.dayHeader, { color: colors.mutedForeground }]}>
                        {h.top}
                      </Text>
                      {h.sub ? (
                        <Text style={[styles.dayHeaderSub, { color: colors.textDim }]}>
                          {h.sub}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {data.poll.slots.map((slot) => (
                <View key={slot} style={styles.gridRow}>
                  <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{slot}</Text>
                  {visibleDays.map((day) => {
                    const cell = `${day}-${slot}`;
                    const c = counts.get(cell) ?? 0;
                    const isLight = total === 0 || c / total < 0.66;
                    const countColor = isLight ? colors.foreground : "#fff";

                    // Build mini avatar stack when cellUsers data is available.
                    const cellUids = data.cellUsers?.[cell];
                    const freeMembers: MemberInfo[] = cellUids
                      ? cellUids.map((id) => memberMap.get(id)).filter((m): m is MemberInfo => m !== undefined)
                      : [];

                    const MINI_MAX = 3;
                    const showStack = c > 0 && freeMembers.length > 0 && freeMembers.length <= MINI_MAX;
                    const showOverflow = c > 0 && freeMembers.length > MINI_MAX;
                    const showFallbackCount = c > 0 && freeMembers.length === 0;

                    return (
                      <TouchableOpacity
                        key={cell}
                        onPress={() => openCellSheet(cell)}
                        activeOpacity={0.7}
                        style={[styles.cell, cellStyle(cell)]}
                      >
                        {showStack && (
                          <View style={styles.miniStack}>
                            {freeMembers.map((m, idx) => (
                              <View
                                key={m.id}
                                style={[
                                  styles.miniAvatar,
                                  {
                                    marginLeft: idx === 0 ? 0 : -5,
                                    zIndex: freeMembers.length - idx,
                                    backgroundColor: colors.primary,
                                    borderColor: colors.background,
                                  },
                                ]}
                              >
                                {m.avatarUrl ? (
                                  <Image source={{ uri: m.avatarUrl }} style={styles.miniAvatarImg} />
                                ) : (
                                  <Text style={styles.miniAvatarLetter}>
                                    {m.displayName.charAt(0).toUpperCase()}
                                  </Text>
                                )}
                              </View>
                            ))}
                          </View>
                        )}
                        {showOverflow && (
                          <Text style={[styles.cellCount, { color: countColor }]}>{c}</Text>
                        )}
                        {showFallbackCount && (
                          <Text style={[styles.cellCount, { color: countColor }]}>{c}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
                  </>
                );
              })()}
            </View>

            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: colors.card, borderColor: colors.border }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>None</Text>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary + "66" }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>Some</Text>
              <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
              <Text style={[styles.legendText, { color: colors.textDim }]}>Everyone</Text>
            </View>

            <Text style={[styles.respText, { color: colors.mutedForeground }]}>
              {total === 0 ? "Be the first to add your times." : `${total} ${total === 1 ? "person has" : "people have"} responded`}
            </Text>
            <Animated.Text style={[styles.updatedText, { color: colors.textDim, opacity: fadeAnim }]}>
              Updated just now
            </Animated.Text>

            {nudgedBanner && (
              <View style={[styles.nudgedBanner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                <Ionicons name="notifications-outline" size={16} color={colors.primary} />
                <Text style={[styles.nudgedBannerText, { color: colors.foreground }]}>{nudgedBanner}</Text>
                <TouchableOpacity onPress={() => setNudgedBanner(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            )}

            {data.members && data.members.length > 0 && (
              <View style={styles.memberSection}>
                {selectedMemberIds.size > 0 && (() => {
                  const selected = data.members?.filter((m) => selectedMemberIds.has(m.id)) ?? [];
                  const count = selected.length;
                  const initials = selected.map((m) => m.displayName.charAt(0).toUpperCase()).join(", ");
                  return count > 0 ? (
                    <TouchableOpacity
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedMemberIds(new Set());
                        clearTooltip();
                      }}
                      style={[styles.filterBanner, { backgroundColor: "#F59E0B22", borderColor: "#F59E0B" }]}
                    >
                      <View style={[styles.filterDot, { backgroundColor: "#F59E0B" }]} />
                      <Text style={[styles.filterBannerText, { color: "#F59E0B" }]}>
                        Showing {count} {count === 1 ? "person's" : "people's"} times ({initials}) — tap to clear
                      </Text>
                      <Ionicons name="close-circle" size={16} color="#F59E0B" />
                    </TouchableOpacity>
                  ) : null;
                })()}
                {(() => {
                  const notResponded = (data.members ?? []).filter((m) => !m.hasResponded);
                  if (notResponded.length === 0) return null;
                  return (
                    <TouchableOpacity
                      onPress={() => { void Haptics.selectionAsync(); setShowPendingModal(true); }}
                      style={styles.pendingCountBtn}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="time-outline" size={13} color={colors.textDim} />
                      <Text style={[styles.pendingCountText, { color: colors.textDim }]}>
                        {notResponded.length} still pending
                      </Text>
                      <Ionicons name="chevron-forward" size={12} color={colors.textDim} />
                    </TouchableOpacity>
                  );
                })()}
                {isCreator && data.members.some((m) => !m.hasResponded) && (
                  <Text style={[styles.memberSectionLabel, { color: colors.mutedForeground }]}>
                    Tap Nudge to remind pending members
                  </Text>
                )}
                <View style={styles.memberList}>
                  {data.members.map((m) => {
                    const isSelected = selectedMemberIds.has(m.id);
                    const showingTooltip = m.id === tooltipMemberId;
                    const upToDate = m.hasResponded && !m.needsUpdate;
                    const stale = m.hasResponded && m.needsUpdate;
                    const avatarBg = isSelected ? "#F59E0B" : (upToDate ? colors.primary : stale ? colors.gold : colors.card);
                    const avatarBorder = isSelected ? "#F59E0B" : (upToDate ? colors.primary : stale ? colors.gold : colors.border);
                    const avatarOpacity = upToDate || isSelected ? 1 : stale ? 0.8 : 0.45;
                    const textColor = upToDate || stale || isSelected ? "#fff" : colors.mutedForeground;
                    const nudgeSt = nudgeState.get(m.id);
                    const canNudge = isCreator && !m.hasResponded;
                    const isSending = nudgeSt === "sending";
                    const isSent = nudgeSt === "sent";
                    return (
                      <View key={m.id} style={styles.memberItem}>
                        <View style={styles.memberAvatarWrap}>
                          {showingTooltip && (
                            <Animated.View style={[styles.avatarTooltip, { backgroundColor: colors.foreground, opacity: tooltipOpacity }]}>
                              <Text style={[styles.avatarTooltipText, { color: colors.background }]} numberOfLines={1}>
                                {m.displayName}
                              </Text>
                              <View style={[styles.avatarTooltipArrow, { borderTopColor: colors.foreground }]} />
                            </Animated.View>
                          )}
                          {m.hasResponded ? (
                            <TouchableOpacity
                              onPress={() => {
                                Haptics.selectionAsync();
                                setSelectedMemberIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(m.id)) next.delete(m.id);
                                  else next.add(m.id);
                                  return next;
                                });
                                showTooltip(m.id);
                              }}
                              onLongPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                showTooltip(m.id);
                              }}
                              delayLongPress={500}
                              activeOpacity={0.7}
                              style={[
                                styles.memberAvatar,
                                {
                                  backgroundColor: avatarBg,
                                  borderColor: avatarBorder,
                                  borderWidth: isSelected ? 2.5 : 1.5,
                                  opacity: avatarOpacity,
                                },
                              ]}
                            >
                              {m.avatarUrl ? (
                                <Image source={{ uri: m.avatarUrl }} style={styles.memberAvatarImage} />
                              ) : (
                                <Text style={[styles.memberInitial, { color: textColor }]}>
                                  {m.displayName.charAt(0).toUpperCase()}
                                </Text>
                              )}
                            </TouchableOpacity>
                          ) : (
                            <View
                              style={[
                                styles.memberAvatar,
                                {
                                  backgroundColor: colors.card,
                                  borderColor: colors.border,
                                  opacity: 0.45,
                                },
                              ]}
                            >
                              {m.avatarUrl ? (
                                <Image source={{ uri: m.avatarUrl }} style={styles.memberAvatarImage} />
                              ) : (
                                <Text style={[styles.memberInitial, { color: colors.mutedForeground }]}>
                                  {m.displayName.charAt(0).toUpperCase()}
                                </Text>
                              )}
                            </View>
                          )}
                          {m.hasResponded && (
                            <View style={[styles.respondedDot, { backgroundColor: isSelected ? "#F59E0B" : stale ? colors.gold : colors.primary }]}>
                              <Ionicons name="checkmark" size={8} color="#fff" />
                            </View>
                          )}
                        </View>
                        <Text
                          style={[styles.memberName, { color: m.hasResponded ? colors.foreground : colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {m.displayName}
                        </Text>
                        {canNudge && (
                          <TouchableOpacity
                            onPress={() => { if (!isSending && !isSent) void sendNudge(m.id); }}
                            disabled={isSending || isSent}
                            style={[
                              styles.nudgeBtn,
                              {
                                backgroundColor: isSent ? colors.card : colors.primary + "22",
                                borderColor: isSent ? colors.border : colors.primary + "66",
                                opacity: isSending ? 0.6 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              name={isSent ? "checkmark-circle-outline" : "notifications-outline"}
                              size={13}
                              color={isSent ? colors.textDim : colors.primary}
                            />
                            <Text style={[styles.nudgeBtnText, { color: isSent ? colors.textDim : colors.primary }]}>
                              {isSending ? "…" : isSent ? "Sent" : "Nudge"}
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
                {data.members.some((m) => m.needsUpdate) && (
                  <View style={[styles.pendingList, { borderColor: colors.border, backgroundColor: colors.card }]}>
                    <View style={styles.pendingHeader}>
                      <Ionicons name="time-outline" size={14} color={colors.gold} />
                      <Text style={[styles.pendingHeaderText, { color: colors.mutedForeground }]}>
                        Still needs to update
                      </Text>
                    </View>
                    {data.members
                      .filter((m) => m.needsUpdate)
                      .map((m) => {
                        const nudged = nudgeState.get(m.id) === "sent";
                        const nudging = nudgeState.get(m.id) === "sending";
                        return (
                          <View key={m.id} style={styles.pendingMemberRow}>
                            <View style={[styles.pendingAvatar, { backgroundColor: m.hasResponded ? colors.gold + "33" : colors.border + "33", borderColor: m.hasResponded ? colors.gold : colors.border }]}>
                              <Text style={[styles.pendingInitial, { color: m.hasResponded ? colors.gold : colors.mutedForeground }]}>
                                {m.displayName.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.pendingName, { color: colors.foreground }]}>{m.displayName}</Text>
                              <Text style={[styles.pendingStatus, { color: colors.textDim }]}>
                                {m.hasResponded ? "Responded before the date change" : "Hasn't responded yet"}
                              </Text>
                            </View>
                            {isCreator && (
                              <TouchableOpacity
                                onPress={() => { void sendNudge(m.id); }}
                                disabled={nudged || nudging}
                                style={[
                                  styles.nudgeBtn,
                                  {
                                    backgroundColor: nudged ? colors.card : colors.primary + "18",
                                    borderColor: nudged ? colors.border : colors.primary,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={nudged ? "checkmark-circle" : "notifications-outline"}
                                  size={13}
                                  color={nudged ? colors.mutedForeground : colors.primary}
                                />
                                <Text style={[styles.nudgeBtnText, { color: nudged ? colors.mutedForeground : colors.primary }]}>
                                  {nudging ? "…" : nudged ? "Nudged" : "Nudge"}
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                  </View>
                )}

                {isCreator && (
                  <View style={[styles.timelineSection, { borderColor: colors.border }]}>
                    <TouchableOpacity
                      onPress={() => { void Haptics.selectionAsync(); setShowTimeline((v) => !v); }}
                      style={styles.timelineToggleRow}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="list-outline" size={14} color={colors.mutedForeground} />
                      <Text style={[styles.timelineToggleText, { color: colors.mutedForeground }]}>
                        Response timeline
                      </Text>
                      <Ionicons name={showTimeline ? "chevron-up" : "chevron-down"} size={13} color={colors.textDim} />
                    </TouchableOpacity>

                    {showTimeline && (() => {
                      const members = data.members ?? [];
                      const sorted = [...members].sort((a, b) => {
                        const rankA = !a.hasResponded ? 2 : a.needsUpdate ? 1 : 0;
                        const rankB = !b.hasResponded ? 2 : b.needsUpdate ? 1 : 0;
                        if (rankA !== rankB) return rankA - rankB;
                        if (a.respondedAt && b.respondedAt) {
                          return new Date(b.respondedAt).getTime() - new Date(a.respondedAt).getTime();
                        }
                        return a.displayName.localeCompare(b.displayName);
                      });

                      return (
                        <View style={styles.timelineList}>
                          {sorted.map((m) => {
                            const upToDate = m.hasResponded && !m.needsUpdate;
                            const stale = m.hasResponded && m.needsUpdate;
                            const pending = !m.hasResponded;

                            const dotColor = upToDate ? colors.primary : stale ? colors.gold : colors.border;
                            const badgeBg = upToDate
                              ? colors.primary + "18"
                              : stale
                              ? colors.gold + "18"
                              : colors.card;
                            const badgeBorder = upToDate
                              ? colors.primary + "66"
                              : stale
                              ? colors.gold + "66"
                              : colors.border;
                            const badgeText = upToDate
                              ? colors.primary
                              : stale
                              ? colors.gold
                              : colors.textDim;
                            const label = upToDate
                              ? m.respondedAt ? timeAgo(m.respondedAt) : "Responded"
                              : stale
                              ? m.respondedAt ? `${timeAgo(m.respondedAt)} (stale)` : "Stale"
                              : "Pending";

                            return (
                              <View key={m.id} style={styles.timelineRow}>
                                <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
                                <View style={[styles.timelineAvatar, { backgroundColor: pending ? colors.card : upToDate ? colors.primary + "22" : colors.gold + "22", borderColor: dotColor }]}>
                                  {m.avatarUrl ? (
                                    <Image source={{ uri: m.avatarUrl }} style={styles.timelineAvatarImg} />
                                  ) : (
                                    <Text style={[styles.timelineAvatarInitial, { color: pending ? colors.mutedForeground : upToDate ? colors.primary : colors.gold }]}>
                                      {m.displayName.charAt(0).toUpperCase()}
                                    </Text>
                                  )}
                                </View>
                                <Text style={[styles.timelineName, { color: colors.foreground, opacity: pending ? 0.6 : 1 }]} numberOfLines={1}>
                                  {m.displayName}
                                </Text>
                                <View style={[styles.timelineBadge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
                                  <Text style={[styles.timelineBadgeText, { color: badgeText }]}>{label}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      );
                    })()}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
            {droppedNotice !== null && (
              <Animated.View style={[styles.droppedBanner, { backgroundColor: colors.card, borderColor: colors.border, opacity: droppedOpacity }]}>
                <Ionicons name="information-circle-outline" size={16} color={colors.mutedForeground} />
                <Text style={[styles.droppedBannerText, { color: colors.mutedForeground }]}>{droppedNotice}</Text>
              </Animated.View>
            )}
            {data.best && !dirty && (
              <TouchableOpacity onPress={() => void useThisTime()} style={[styles.secondaryBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "14" }]}>
                <Ionicons name={eventId ? "checkmark-circle-outline" : "calendar-outline"} size={18} color={colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                  {eventId ? `Use ${prettyCell(data.best.cell)}` : "Create event at best time"}
                </Text>
              </TouchableOpacity>
            )}
            <GradientButton
              label={saving ? "Saving…" : dirty ? "Save my availability" : "Saved"}
              onPress={() => void save()}
              disabled={saving || !dirty}
            />
          </View>
        </>
      ) : null}

      {/* Cell detail sheet — who's free at a given time slot */}
      <Modal
        visible={selectedCell !== null}
        animationType="slide"
        transparent
        onRequestClose={closeCellSheet}
      >
        <View style={styles.pickerOverlay}>
          <View style={[styles.cellSheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]}>
            <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
              <View style={styles.pickerBtn} />
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
                {selectedCell ? prettyCell(selectedCell) : ""}
              </Text>
              <TouchableOpacity onPress={closeCellSheet} style={styles.pickerBtn}>
                <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
              {/* Who's free */}
              {(() => {
                if (!selectedCell || !data) return null;
                const freeIds = new Set(data.cellUsers?.[selectedCell] ?? []);
                const freeMembers = (data.members ?? []).filter((m) => freeIds.has(m.id));
                const isFree = mySet.has(selectedCell);
                const isMeUnsaved =
                  isFree && currentUser != null && !freeIds.has(currentUser.id);
                const totalFreeCount = freeMembers.length + (isMeUnsaved ? 1 : 0);

                return (
                  <>
                    {totalFreeCount > 0 ? (
                      <>
                        <Text style={[styles.cellSheetSectionLabel, { color: colors.mutedForeground }]}>
                          {totalFreeCount} {totalFreeCount === 1 ? "person" : "people"} free
                        </Text>
                        <View style={styles.cellSheetMemberList}>
                          {isMeUnsaved && currentUser && (
                            <View key="me-unsaved" style={[styles.cellSheetMemberRow, styles.cellSheetMemberRowUnsaved]}>
                              <View
                                style={[
                                  styles.cellSheetAvatar,
                                  { backgroundColor: colors.primary + "88", borderColor: colors.primary, borderWidth: 1.5, borderStyle: "dashed" },
                                ]}
                              >
                                <Text style={styles.cellSheetAvatarInitial}>
                                  {currentUser.initials.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <Text style={[styles.cellSheetMemberName, { color: colors.foreground }]}>
                                {currentUser.name}
                              </Text>
                              <View style={[styles.unsavedBadge, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "66" }]}>
                                <Text style={[styles.unsavedBadgeText, { color: colors.primary }]}>unsaved</Text>
                              </View>
                            </View>
                          )}
                          {freeMembers.map((m) => (
                            <View key={m.id} style={styles.cellSheetMemberRow}>
                              <View
                                style={[
                                  styles.cellSheetAvatar,
                                  { backgroundColor: colors.primary, borderColor: colors.primary },
                                ]}
                              >
                                {m.avatarUrl ? (
                                  <Image source={{ uri: m.avatarUrl }} style={styles.cellSheetAvatarImage} />
                                ) : (
                                  <Text style={styles.cellSheetAvatarInitial}>
                                    {m.displayName.charAt(0).toUpperCase()}
                                  </Text>
                                )}
                              </View>
                              <Text style={[styles.cellSheetMemberName, { color: colors.foreground }]}>
                                {m.displayName}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </>
                    ) : (
                      <Text style={[styles.cellSheetEmpty, { color: colors.mutedForeground }]}>
                        No one marked free yet — be the first!
                      </Text>
                    )}

                    <TouchableOpacity
                      onPress={() => {
                        toggleCell(selectedCell);
                        closeCellSheet();
                      }}
                      style={[
                        styles.cellSheetToggleBtn,
                        {
                          backgroundColor: isFree ? colors.card : colors.primary,
                          borderColor: isFree ? colors.border : colors.primary,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isFree ? "close-circle-outline" : "checkmark-circle-outline"}
                        size={18}
                        color={isFree ? colors.mutedForeground : "#fff"}
                      />
                      <Text style={[styles.cellSheetToggleBtnText, { color: isFree ? colors.mutedForeground : "#fff" }]}>
                        {isFree ? "I'm no longer free" : "Mark me as free"}
                      </Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Pending members modal */}
      <Modal
        visible={showPendingModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPendingModal(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={[styles.cellSheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]}>
            <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
              <View style={styles.pickerBtn} />
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Still pending</Text>
              <TouchableOpacity onPress={() => setShowPendingModal(false)} style={styles.pickerBtn}>
                <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}>
              {(() => {
                const notResponded = (data?.members ?? []).filter((m) => !m.hasResponded);
                if (notResponded.length === 0) {
                  return (
                    <Text style={[styles.cellSheetEmpty, { color: colors.mutedForeground }]}>
                      Everyone has responded!
                    </Text>
                  );
                }
                return (
                  <>
                    <Text style={[styles.cellSheetSectionLabel, { color: colors.mutedForeground }]}>
                      {notResponded.length} {notResponded.length === 1 ? "person hasn't" : "people haven't"} responded yet
                    </Text>
                    <View style={styles.cellSheetMemberList}>
                      {notResponded.map((m) => (
                        <View key={m.id} style={styles.cellSheetMemberRow}>
                          <View style={[styles.cellSheetAvatar, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1.5 }]}>
                            {m.avatarUrl ? (
                              <Image source={{ uri: m.avatarUrl }} style={styles.cellSheetAvatarImage} />
                            ) : (
                              <Text style={[styles.cellSheetAvatarInitial, { color: colors.mutedForeground }]}>
                                {m.displayName.charAt(0).toUpperCase()}
                              </Text>
                            )}
                          </View>
                          <Text style={[styles.cellSheetMemberName, { color: colors.foreground }]}>
                            {m.displayName}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit range modal — host only */}
      <Modal
        visible={editRangeOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setEditRangeOpen(false)}
      >
        <View style={styles.pickerOverlay}>
          <View style={[styles.editSheet, { backgroundColor: colors.background, paddingBottom: botPad + 12 }]}>
            <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setEditRangeOpen(false)} style={styles.pickerBtn}>
                <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Edit Date Range</Text>
              <TouchableOpacity onPress={() => void updateRange()} disabled={updating} style={styles.pickerBtn}>
                <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700", opacity: updating ? 0.5 : 1 }]}>
                  {updating ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
              <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Poll title (optional)</Text>
              <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="text-outline" size={18} color={colors.mutedForeground} />
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="e.g. Summer trip dates"
                  placeholderTextColor={colors.textDim}
                  maxLength={120}
                  style={[styles.dateBtnText, { color: colors.foreground }]}
                />
              </View>

              <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Start date</Text>
              {Platform.OS === "web" ? (
                <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}>
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <TextInput
                    value={toISODate(editStart)}
                    onChangeText={(t) => {
                      const d = parseISODate(t.trim());
                      if (d) setEditStart(d);
                    }}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={colors.textDim}
                    style={[styles.dateBtnText, { color: colors.foreground }]}
                  />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setEditPickerDate(editStart);
                    setEditPickerOpen(true);
                  }}
                  style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: colors.primary }]}
                >
                  <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                  <Text style={[styles.dateBtnText, { color: colors.foreground }]}>{prettyDay(toISODate(editStart))}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}

              <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>How many days?</Text>
              <View style={styles.chipRow}>
                {DAY_COUNT_OPTIONS.map((n) => {
                  const active = editDays === n;
                  return (
                    <TouchableOpacity
                      key={n}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setEditDays(n);
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{n} days</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Time slots</Text>
              <View style={styles.chipRow}>
                {ALL_SLOT_OPTIONS.map((s) => {
                  const active = editSlots.has(s);
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setEditSlots((prev) => {
                          const next = new Set(prev);
                          if (next.has(s)) {
                            if (next.size > 1) next.delete(s);
                          } else {
                            next.add(s);
                          }
                          return next;
                        });
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={[styles.previewText, { color: colors.foreground }]}>{editRangePreview}</Text>
              </View>

              <Text style={[styles.editRangeNote, { color: colors.mutedForeground }]}>
                Existing responses outside the new range will be trimmed automatically.
              </Text>
            </ScrollView>

            {Platform.OS === "android" && editPickerOpen && (
              <DateTimePicker
                value={editPickerDate}
                mode="date"
                display="default"
                onChange={(_, d) => {
                  setEditPickerOpen(false);
                  if (d) setEditStart(d);
                }}
              />
            )}
          </View>
        </View>

        {Platform.OS === "ios" && editPickerOpen && (
          <Modal visible animationType="slide" transparent onRequestClose={() => setEditPickerOpen(false)}>
            <View style={styles.pickerOverlay}>
              <View style={[styles.pickerSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 8 }]}>
                <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
                  <TouchableOpacity onPress={() => setEditPickerOpen(false)} style={styles.pickerBtn}>
                    <Text style={[styles.pickerBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Start Date</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditStart(editPickerDate);
                      setEditPickerOpen(false);
                    }}
                    style={styles.pickerBtn}
                  >
                    <Text style={[styles.pickerBtnText, { color: colors.primary, fontWeight: "700" }]}>Done</Text>
                  </TouchableOpacity>
                </View>
                <DateTimePicker
                  value={editPickerDate}
                  mode="date"
                  display="spinner"
                  onChange={(_, d) => { if (d) setEditPickerDate(d); }}
                  themeVariant="dark"
                  style={{ width: "100%", height: 200 }}
                />
              </View>
            </View>
          </Modal>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  backBtn: { padding: 8 },
  headerTitleBlock: { flex: 1, justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "900" },
  renamedByText: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { fontSize: 15, textAlign: "center" },
  retryBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { fontSize: 14, fontWeight: "700" },
  body: { flex: 1 },
  subtitle: { fontSize: 14, lineHeight: 21, paddingTop: 16, paddingBottom: 4 },
  heroWrap: { marginTop: 16, borderRadius: 20, shadowColor: "#FF5C3A", shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 18 },
  setupHeroCard: { borderRadius: 20, paddingVertical: 22, paddingHorizontal: 20, gap: 10 },
  setupHeroTitle: { fontSize: 22, fontWeight: "900", color: "#fff", letterSpacing: -0.4, lineHeight: 27 },
  setupHeroSub: { fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.92)", fontWeight: "500" },
  heroIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  heroLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: "rgba(255,255,255,0.9)" },
  heroValue: { fontSize: 22, fontWeight: "900", color: "#fff", marginTop: 3, letterSpacing: -0.3 },
  heroFreePill: { alignItems: "center", borderRadius: 14, backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 13, paddingVertical: 8 },
  heroFreeCount: { fontSize: 16, fontWeight: "900", color: "#fff" },
  heroFreeLabel: { fontSize: 10, fontWeight: "800", color: "rgba(255,255,255,0.9)", marginTop: 1, textTransform: "uppercase", letterSpacing: 0.5 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: 11, fontWeight: "600" },
  gridWrap: { marginTop: 22 },
  pagerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  pagerBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pagerLabelWrap: { flex: 1, alignItems: "center" },
  pagerLabel: { fontSize: 15, fontWeight: "800" },
  pagerSub: { fontSize: 11, fontWeight: "600", marginTop: 1 },
  gridHeaderRow: { flexDirection: "row", marginBottom: 7 },
  timeLabelCol: { width: 38 },
  dayHeaderCol: { flex: 1, alignItems: "center" },
  dayHeader: { textAlign: "center", fontSize: 12, fontWeight: "800" },
  dayHeaderSub: { textAlign: "center", fontSize: 10, fontWeight: "600", marginTop: 1 },
  gridRow: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  timeLabel: { width: 38, fontSize: 11, fontWeight: "700" },
  cell: { flex: 1, height: 42, marginHorizontal: 2.5, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  cellCount: { fontSize: 13, fontWeight: "800" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 18, flexWrap: "wrap" },
  legendSwatch: { width: 18, height: 18, borderRadius: 6, borderWidth: 1, borderColor: "transparent" },
  legendText: { fontSize: 12, marginRight: 8 },
  respText: { fontSize: 13, marginTop: 16, fontWeight: "700" },
  updatedText: { fontSize: 11, fontWeight: "600", marginTop: 4 },
  memberSection: { marginTop: 16 },
  memberSectionLabel: { fontSize: 12, fontWeight: "600", marginBottom: 10 },
  memberList: { gap: 8 },
  memberItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  memberAvatarWrap: { position: "relative", alignItems: "center" },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  memberAvatarImage: { width: 38, height: 38, borderRadius: 19 },
  respondedDot: { position: "absolute", bottom: -2, right: -2, width: 15, height: 15, borderRadius: 7.5, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#0A0A0F" },
  memberInitial: { fontSize: 14, fontWeight: "800" },
  avatarTooltip: {
    position: "absolute",
    bottom: 42,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 10,
    alignItems: "center",
    maxWidth: 120,
  },
  avatarTooltipText: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  avatarTooltipArrow: {
    position: "absolute",
    bottom: -5,
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 5,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  memberName: { flex: 1, fontSize: 14, fontWeight: "600" },
  memberPendingText: { fontSize: 12, marginTop: 8, fontWeight: "600" },
  pendingCountBtn: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginBottom: 10, paddingVertical: 4, paddingHorizontal: 2 },
  pendingCountText: { fontSize: 12, fontWeight: "600" },
  filterBanner: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 10 },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  filterBannerText: { flex: 1, fontSize: 12, fontWeight: "700" },
  pendingList: { marginTop: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  pendingHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  pendingHeaderText: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  pendingMemberRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pendingAvatar: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pendingInitial: { fontSize: 12, fontWeight: "800" },
  pendingName: { fontSize: 13, fontWeight: "700" },
  pendingStatus: { fontSize: 11, marginTop: 1 },
  nudgeBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  nudgeBtnText: { fontSize: 12, fontWeight: "700" },
  nudgedBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, padding: 13, marginTop: 16 },
  nudgedBannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  bottomBar: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, gap: 12 },
  droppedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  droppedBannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, borderWidth: 1.5, paddingVertical: 15 },
  secondaryBtnText: { fontSize: 15, fontWeight: "800" },
  setupLabel: { fontSize: 12, fontWeight: "800", marginTop: 22, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 },
  dateBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14 },
  dateBtnText: { flex: 1, fontSize: 15, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  chip: { borderRadius: 22, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 9 },
  chipText: { fontSize: 14, fontWeight: "700" },
  previewCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, padding: 15, marginTop: 22 },
  previewText: { flex: 1, fontSize: 15, fontWeight: "700" },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1 },
  pickerBtn: { padding: 8 },
  pickerBtnText: { fontSize: 15 },
  pickerTitle: { fontSize: 16, fontWeight: "800" },
  editRangeBtn: { padding: 8, marginLeft: "auto" },
  editSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" },
  editRangeNote: { fontSize: 13, lineHeight: 18, marginTop: 18 },
  rangeUpdatedBanner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, marginTop: 14 },
  rangeUpdatedText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  newResponseBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 11, marginTop: 14 },
  newResponseBadge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  newResponseBadgeText: { fontSize: 12, fontWeight: "800", color: "#fff" },
  newResponseText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  miniStack: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
  miniAvatar: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  miniAvatarImg: { width: 16, height: 16, borderRadius: 8 },
  miniAvatarLetter: { fontSize: 7, fontWeight: "800", color: "#fff" },
  cellSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "70%" },
  cellSheetSectionLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 },
  cellSheetMemberList: { gap: 12, marginBottom: 24 },
  cellSheetMemberRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  cellSheetMemberRowUnsaved: { opacity: 0.85 },
  unsavedBadge: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2, marginLeft: "auto" },
  unsavedBadgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  cellSheetAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  cellSheetAvatarImage: { width: 40, height: 40, borderRadius: 20 },
  cellSheetAvatarInitial: { fontSize: 16, fontWeight: "800", color: "#fff" },
  cellSheetMemberName: { fontSize: 15, fontWeight: "600" },
  cellSheetEmpty: { fontSize: 14, lineHeight: 20, marginBottom: 24 },
  cellSheetToggleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, borderWidth: 1.5, paddingVertical: 15, marginTop: 4 },
  cellSheetToggleBtnText: { fontSize: 15, fontWeight: "800" },
  timelineSection: { marginTop: 12, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  timelineToggleRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 11 },
  timelineToggleText: { flex: 1, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  timelineList: { paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timelineDot: { width: 7, height: 7, borderRadius: 3.5 },
  timelineAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  timelineAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  timelineAvatarInitial: { fontSize: 11, fontWeight: "800" },
  timelineName: { flex: 1, fontSize: 13, fontWeight: "600" },
  timelineBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  timelineBadgeText: { fontSize: 11, fontWeight: "700" },
});
