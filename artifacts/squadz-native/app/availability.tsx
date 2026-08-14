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
  Share,
  type AppStateStatus,
} from "react-native";
import { router, useLocalSearchParams, useFocusEffect, useNavigation } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useColors } from "@/hooks/useColors";
import { useAvailabilityStream } from "@/hooks/useAvailabilityStream";
import { useInteractionGuard, useModalGuard } from "@/hooks/useInteractionGuard";
import { useAuth } from "@/context/AppContext";
import { useToastBanner } from "@/context/ToastBannerContext";
import { claimOnce } from "@/lib/seenFlags";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { GradientButton } from "@/components/GradientButton";
import { SkeletonBox } from "@/components/SkeletonBox";
import {
  DAY_COUNT_OPTIONS,
  DEFAULT_DAY_COUNT,
  ALL_SLOT_OPTIONS,
  DEFAULT_SLOTS,
  TRIP_SLOT,
  TRIP_SLOTS,
  SLOT_PERIODS,
  sortSlotsChronologically,
  periodForSlot,
  selectionsOutsidePeriod,
  pollWizardSteps,
  isLastWizardStep,
  nextWizardStep,
  prevWizardStep,
  canAdvanceWizard,
  wizardReviewLine,
  computeTrimLoss,
  computeTrimLossFromHeatmap,
  trimLossMessage,
  saveButtonState,
  buildFollowUpList,
  memberFollowUpState,
  followUpStateLabel,
  canNudgeMember,
  wizardHasInput,
  editRangeSnapshot,
  editRangeDirty,
  editChangesGrid,
  DEFAULT_TRIP_LENGTH_DAYS,
  MIN_TRIP_LENGTH_DAYS,
  MAX_POLL_DAY_COUNT,
  tripLengthOptionsFor,
  planLengthOptionsFor,
  clampTripLength,
  clampPlanLength,
  createPlanLengthValue,
  minPlanLength,
  timelineChoiceFor,
  customDayCountError,
  customPlanLengthError,
  planNoun,
  type PollKind,
  type TimelineChoice,
  initialEditTripLength,
  editTripLengthPatchValue,
  tripStretchFor,
  canStartTripOn,
  pollResultKind,
  shouldNudgePollWinner,
} from "@/lib/pollWizard";
import {
  pollDraftKey,
  readPollDraft,
  savePollDraft,
  clearPollDraft,
  draftHasContent,
} from "@/lib/pollDraft";

// How many day-columns are shown in the grid at once. Larger ranges page
// through these windows with prev/next arrows instead of cramming every day
// onto one screen.
const DAY_WINDOW = 5;
const SLOT_WINDOW = 6;

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
    /**
     * Explicit poll type from the server. This — not the "All day" slot
     * sentinel, and not the `kind` route param — is what decides whether the
     * board behaves as a trip. A poll opened by link carries no route param, so
     * reading the type off the loaded poll is the only correct source.
     */
    kind?: "event" | "trip";
    /** Trip length in days; null on event polls and on legacy trip polls. */
    tripLengthDays?: number | null;
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
  /**
   * Trip polls that know their length answer with a consecutive RUN of days.
   * `partial: true` means nobody is free for the whole run and this is the
   * least-bad window — the UI must say so rather than presenting a winner.
   */
  bestStretch?: {
    startDate: string;
    endDate: string;
    lengthDays: number;
    count: number;
    partialCount: number;
    total: number;
    partial: boolean;
  } | null;
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

// Convert a dated cell key (`2026-06-14-7PM`) into a machine-readable ISO start
// so the event can be expired/filtered precisely. Returns undefined for legacy
// weekday-only polls (no concrete calendar date) — those just keep the friendly
// display string and never auto-expire.
function cellToISO(cell: string | null): string | undefined {
  if (!cell) return undefined;
  const { day, slot } = splitCell(cell);
  const base = parseISODate(day);
  if (!base) return undefined;
  const m = /^(\d{1,2})\s*(AM|PM)$/i.exec(slot);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[2].toUpperCase() === "PM") h += 12;
    base.setHours(h, 0, 0, 0);
  }
  return base.toISOString();
}

export default function AvailabilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { authToken, currentUser } = useAuth();
  const { showBanner } = useToastBanner();
  const params = useLocalSearchParams<{ squadId?: string; eventId?: string; pollId?: string; from?: string; adhoc?: string; participantIds?: string; kind?: string }>();
  const squadId = params.squadId || undefined;
  const eventId = params.eventId || undefined;
  const pollId = params.pollId || undefined;
  // Ad-hoc "new plan" poll (T3): no squad/event scope; the roster is an explicit
  // set of invitees chosen on the previous screen and passed as a CSV param.
  const adhoc = params.adhoc === "1";
  const participantIds = (params.participantIds || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // True when the screen was opened from the event-creation flow. In that case
  // we always start a fresh poll setup rather than reloading the squad's last
  // (possibly abandoned) board.
  const fromCreate = params.from === "create";
  // Trip vs Event: events are day + time-slot focused; trips are date-range
  // focused (a single "All day" slot, so the grid collapses to a per-day toggle).
  //
  // The route param only describes a poll being CREATED. Once a poll is loaded
  // its own `kind` is authoritative — a poll opened by link (or by pollId) has
  // no param at all, and inferring the type from the "All day" slot sentinel is
  // exactly the coupling this feature removed.
  //
  // A MISSING param is not "event". Most entry points (a squad's "Start a new
  // poll", an event screen's Find-a-time, the create flow) never passed one, so
  // defaulting silently produced an event poll and left no way to say
  // otherwise. Undefined now means "ask", and the wizard opens on a Type step.
  const paramKind: PollKind | undefined =
    params.kind === "trip" ? "trip" : params.kind === "event" ? "event" : undefined;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const botPad = insets.bottom + (Platform.OS === "web" ? 34 : 0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PollPayload | null>(null);
  const [mySet, setMySet] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Distinguishes "you have never saved" from "your save just landed" — the old
  // button read "Saved" on first open, before the user had written anything.
  const [justSaved, setJustSaved] = useState(false);
  const [droppedNotice, setDroppedNotice] = useState<string | null>(null);
  const droppedOpacity = useRef(new Animated.Value(0)).current;
  const droppedAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // The type the user picked in the wizard. Null until they answer, which is
  // what makes the Type step a real question rather than a confirmation of a
  // default. Seeded from the route param when an entry point already asked.
  const [chosenKind, setChosenKind] = useState<PollKind | null>(paramKind ?? null);
  const chosenKindRef = useRef<PollKind | null>(paramKind ?? null);
  const kindSelectionTouchedRef = useRef(false);
  // True when this creation flow has to ask. Entry points that pass an explicit
  // kind don't (the Home chooser already asked).
  const needsKindStep = paramKind === undefined;

  // Once a poll is loaded it decides its own type; before then (the creation
  // wizard) the user's answer — or the entry point's explicit param — is all we
  // have. An unanswered wizard is laid out as an event so the step list is
  // stable; nothing can be created until the question is answered.
  const isTrip = data ? (data.poll.kind ?? "event") === "trip" : chosenKind === "trip";
  // The loaded poll's PLAN length, on either kind. Null on single-day events
  // and on legacy trip polls created before plan length existed — those keep
  // single-best-day results rather than being retro-fitted with a length nobody
  // chose. Duration is a plan property, not a trip-only one, so an event poll
  // with a stored length is stretch-ranked exactly like a trip.
  const loadedTripLength =
    data && typeof data.poll.tripLengthDays === "number" && data.poll.tripLengthDays >= MIN_TRIP_LENGTH_DAYS
      ? data.poll.tripLengthDays
      : null;

  // Which result the board is allowed to show. Rule (and the reasoning for it)
  // lives in lib/pollWizard so it's unit-tested without mounting the screen.
  const resultKind = pollResultKind({
    hasStretch: !!data?.bestStretch,
    hasBest: !!data?.best,
    tripLengthDays: loadedTripLength,
  });

  // Set when this poll has already been turned into a plan. The board is
  // terminal at that point: no grid, no saves, just a link to the plan.
  const [convertedEventId, setConvertedEventId] = useState<string | null>(null);
  // Trips and events are the same row on different routes — without the type
  // the "View the plan" button dead-ends for every poll that became a trip.
  const [convertedEventType, setConvertedEventType] = useState<string | null>(null);
  // An ad-hoc URL with no pollId: nothing to resolve, because ad-hoc polls are
  // only ever reachable by their own id.
  const [adhocLinkUnsupported, setAdhocLinkUnsupported] = useState(false);
  // A squad/event scope with 2+ active polls: we refuse to guess which one.
  const [ambiguousScope, setAmbiguousScope] = useState(false);

  const [rangeUpdatedBanner, setRangeUpdatedBanner] = useState(false);
  const [rangeUpdatedVisible, setRangeUpdatedVisible] = useState(false);
  const rangeUpdatedOpacity = useRef(new Animated.Value(0)).current;

  // Setup state: shown when no poll exists yet so the creator can pick the
  // availability range (start date + number of days) before it's created.
  const [needsSetup, setNeedsSetup] = useState(false);
  // Index of the first day column currently shown in the paged grid.
  const [dayWindowStart, setDayWindowStart] = useState(0);
  // Index of the first slot row currently shown in the paged grid.
  const [slotWindowStart, setSlotWindowStart] = useState(0);
  const [creating, setCreating] = useState(false);
  const [pollTitle, setPollTitle] = useState("");
  const [rangeStart, setRangeStart] = useState<Date>(new Date());
  const [rangeDays, setRangeDays] = useState<number>(DEFAULT_DAY_COUNT);
  const [rangeDaysChoice, setRangeDaysChoice] = useState<TimelineChoice>("preset");
  const [customRangeDays, setCustomRangeDays] = useState(String(DEFAULT_DAY_COUNT));
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set(DEFAULT_SLOTS));
  const [slotPeriod, setSlotPeriod] = useState<string>("Evening");
  // How long the PLAN runs inside the voting window — asked for events and
  // trips alike, because a two-day event needs the best run of days just as
  // much as a two-day trip does.
  const [tripLength, setTripLength] = useState<number>(DEFAULT_TRIP_LENGTH_DAYS);
  const [tripLengthChoice, setTripLengthChoice] = useState<TimelineChoice>("preset");
  const [customTripLength, setCustomTripLength] = useState(String(DEFAULT_TRIP_LENGTH_DAYS));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  // Creation wizard: [type →] name → dates → length [→ times]. One decision per
  // screen instead of the old single scrolling form.
  const [wizardStep, setWizardStep] = useState(0);
  const wizardSteps = useMemo(
    () => pollWizardSteps(isTrip, needsKindStep),
    [isTrip, needsKindStep],
  );
  const currentStepId = wizardSteps[Math.min(wizardStep, wizardSteps.length - 1)]?.id ?? "name";
  // Set once a stored draft has been read (or found absent) so the auto-save
  // effect below can't persist the empty defaults over a real draft during the
  // first render pass.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftScopeKey = useMemo(
    () => pollDraftKey({ squadId, eventId, adhoc }),
    [squadId, eventId, adhoc],
  );

  // Tracks the poll's updatedAt that the user has already dismissed, so a
  // background refresh doesn't resurrect a banner they already saw/dismissed.
  const dismissedRangeUpdateRef = useRef<string | null>(null);

  // ---- Creation-draft persistence ----
  //
  // Restore any in-progress draft for THIS scope once, before the auto-save
  // effect starts writing. Without this, backing out of the wizard (or an app
  // kill) discarded the title, range and slot picks entirely.
  //
  // Do not depend on `isTrip` here. It is derived from `chosenKind`, so adding
  // it would make a type tap re-run this async restore and let an older draft
  // read overwrite the user's new Event/Trip choice.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await readPollDraft(draftScopeKey);
      if (cancelled) return;
      if (draft) {
        const start = parseISODate(draft.rangeStartISO);
        if (start) setRangeStart(start);
        setPollTitle(draft.title);
        setRangeDays(draft.rangeDays);
        setCustomRangeDays(String(draft.rangeDays));
        setRangeDaysChoice(timelineChoiceFor(draft.rangeDays, DAY_COUNT_OPTIONS, draft.rangeDaysChoice));
        if (draft.slots.length > 0) setSelectedSlots(new Set(draft.slots));
        if (draft.period) setSlotPeriod(draft.period);
        // An explicit route param outranks the draft: the user just answered
        // "Event or Trip?" on the way in, so a stale draft answer must not
        // overwrite it.
        const restoredKind = paramKind ?? draft.kind ?? null;
        const effectiveKind = kindSelectionTouchedRef.current
          ? chosenKindRef.current
          : restoredKind;
        if (!kindSelectionTouchedRef.current) {
          chosenKindRef.current = restoredKind;
          setChosenKind(restoredKind);
        }
        // Drafts written before plan length existed simply don't carry one —
        // keep the default rather than discarding an otherwise valid draft.
        if (draft.tripLengthDays !== undefined) {
          const kindForDraft: PollKind = effectiveKind ?? "event";
          setTripLength(clampPlanLength(draft.tripLengthDays, draft.rangeDays, kindForDraft));
          setCustomTripLength(String(draft.tripLengthDays));
          setTripLengthChoice(
            timelineChoiceFor(
              draft.tripLengthDays,
              planLengthOptionsFor(draft.rangeDays, kindForDraft),
              draft.tripLengthChoice,
            ),
          );
        }
        const restoredIsTrip = effectiveKind === "trip";
        setWizardStep(
          Math.min(draft.step, pollWizardSteps(restoredIsTrip, paramKind === undefined).length - 1),
        );
        if (
          draftHasContent(draft, {
            rangeDays: DEFAULT_DAY_COUNT,
            slots: DEFAULT_SLOTS,
            tripLengthDays: DEFAULT_TRIP_LENGTH_DAYS,
          })
        ) {
          setDraftRestored(true);
        }
      }
      setDraftLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [draftScopeKey, paramKind]);

  // Persist the wizard's fields on every change while the setup form is the
  // active surface. Skipped until the initial read completes and once a poll
  // exists (there is no draft to keep at that point).
  useEffect(() => {
    if (!draftLoaded || !needsSetup) return;
    void savePollDraft(draftScopeKey, {
      title: pollTitle,
      rangeStartISO: toISODate(rangeStart),
      rangeDays,
      rangeDaysChoice,
      slots: [...selectedSlots],
      period: slotPeriod,
      step: wizardStep,
      // Duration is persisted for BOTH kinds now — the draft has to survive a
      // multi-day event just as it does a trip.
      tripLengthDays: tripLength,
      tripLengthChoice,
      ...(chosenKind ? { kind: chosenKind } : {}),
    });
  }, [
    draftLoaded,
    needsSetup,
    draftScopeKey,
    pollTitle,
    rangeStart,
    rangeDays,
    rangeDaysChoice,
    selectedSlots,
    slotPeriod,
    wizardStep,
    chosenKind,
    tripLength,
    tripLengthChoice,
  ]);

  // Shrinking the voting window under the chosen duration would make the poll
  // impossible; follow it down instead of failing at create time.
  useEffect(() => {
    // Preset behaviour stays convenient: if the window shrinks, a suggested
    // duration follows it down. A Custom value must instead remain visible with
    // an honest "doesn't fit" message until the organizer corrects it.
    if (tripLengthChoice === "custom") return;
    setTripLength((n) => {
      const next = clampPlanLength(n, rangeDays, isTrip ? "trip" : "event");
      if (next !== n) {
        setCustomTripLength(String(next));
      }
      return next;
    });
  }, [isTrip, rangeDays, tripLengthChoice]);

  // Switching Event → Trip with a 1-day duration selected would leave an
  // illegal trip length on screen; lift it to the trip minimum.
  useEffect(() => {
    if (!isTrip) return;
    setTripLength((n) => {
      if (n >= MIN_TRIP_LENGTH_DAYS) return n;
      const next = clampPlanLength(MIN_TRIP_LENGTH_DAYS, rangeDays, "trip");
      setCustomTripLength(String(next));
      return next;
    });
  }, [isTrip, rangeDays]);

  const rangeCustomError = rangeDaysChoice === "custom" ? customDayCountError(customRangeDays) : null;
  const tripCustomError =
    tripLengthChoice === "custom"
      ? customPlanLengthError(customTripLength, rangeDays, isTrip ? "trip" : "event")
      : null;

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

  // Has the user actually put work into the creation wizard? (rule + rationale
  // live in lib/pollWizard so they're unit-tested without mounting the screen)
  const wizardDirty = wizardHasInput({
    title: pollTitle,
    stepIndex: wizardStep,
    rangeDays,
    rangeStartISO: toISODate(rangeStart),
    todayISO: toISODate(new Date()),
    tripLengthDays: tripLength,
  });
  const wizardDirtyRef = useRef(false);
  useEffect(() => {
    // Only while the wizard is the surface on screen — never once a poll loads.
    wizardDirtyRef.current = needsSetup && wizardDirty;
  }, [needsSetup, wizardDirty]);

  /**
   * Suppresses the leave guard for navigation WE initiated after the work
   * finished — creating the poll, deleting it, locking a time in.
   *
   * `beforeRemove` fires for programmatic navigation too, and the state that
   * clears the dirty flags only lands on the next render, so without this the
   * success path prompts "Leave without creating the poll?" one beat after the
   * poll was created.
   */
  const bypassLeaveGuardRef = useRef(false);
  const leaveAfterSuccess = useCallback((go: () => void) => {
    bypassLeaveGuardRef.current = true;
    go();
  }, []);

  // Intercept ALL back-navigation through one listener — the header button,
  // Android hardware back, the iOS swipe-back gesture and the wizard's own
  // Cancel all end up here, so they can't drift apart.
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove" as never, (e: {
      preventDefault: () => void;
      data: { action: object };
    }) => {
      if (bypassLeaveGuardRef.current) {
        bypassLeaveGuardRef.current = false;
        return;
      }
      const leavingGridEdits = dirtyRef.current;
      const leavingWizard = wizardDirtyRef.current;
      if (!leavingGridEdits && !leavingWizard) return;
      e.preventDefault();
      const leave = () => (navigation as { dispatch: (action: object) => void }).dispatch(e.data.action);
      if (leavingGridEdits) {
        Alert.alert(
          "Unsaved changes",
          "You have unsaved availability — leave anyway?",
          [
            { text: "Stay", style: "cancel" },
            { text: "Leave", style: "destructive", onPress: leave },
          ],
        );
        return;
      }
      Alert.alert(
        "Leave without creating the poll?",
        "We'll keep what you've entered so you can pick up where you left off.",
        [
          { text: "Keep editing", style: "cancel" },
          { text: "Leave", style: "destructive", onPress: leave },
        ],
      );
    });
    return unsubscribe;
  }, [navigation]);

  // Keep a ref that tells background polling whether a real poll is loaded.
  const hasPollRef = useRef(false);
  useEffect(() => { hasPollRef.current = data !== null; }, [data]);

  // The id of the poll actually on screen. Every refresh keys off THIS, never
  // off the scope — resolving a scope re-picks the newest poll, which silently
  // swaps the board out from under someone mid-edit.
  const openPollIdRef = useRef<string | null>(pollId ?? null);
  useEffect(() => {
    if (data?.poll.id) openPollIdRef.current = data.poll.id;
    else if (pollId) openPollIdRef.current = pollId;
  }, [data?.poll.id, pollId]);

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

  // Alternate-slot picker: lets anyone lock in a time OTHER than the computed
  // best one without leaving the poll (the old "Set a different time" link
  // pushed to a blank create form and threw the poll's data away).

  // Edit range state: host-only modal to update an existing poll's date range and title.
  const [editRangeOpen, setEditRangeOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editStart, setEditStart] = useState<Date>(new Date());
  const [editDays, setEditDays] = useState<number>(DEFAULT_DAY_COUNT);
  const [editSlots, setEditSlots] = useState<Set<string>>(new Set(DEFAULT_SLOTS));
  const [editSlotPeriod, setEditSlotPeriod] = useState<string>("Evening");
  // Trip polls only: the edit sheet can change how long the trip runs. This is
  // NOT a grid change — it re-ranks the same cells — so it must never trigger
  // the destructive-loss confirmation.
  // Null means "this trip has no length" — the state a LEGACY trip poll is in.
  // It is not a placeholder for the default: seeding a number here would make
  // the sheet dirty the moment it opens and let Save convert the poll to
  // stretch-ranking without the host ever choosing a duration.
  const [editTripLength, setEditTripLength] = useState<number | null>(null);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  // What the edit sheet looked like when it opened, for the dirty-cancel guard.
  const editBaselineRef = useRef<{
    startISO: string;
    days: number;
    slots: string;
    title: string;
    tripLengthDays: number | null;
  } | null>(null);
  const [editPickerDate, setEditPickerDate] = useState<Date>(new Date());
  const [updating, setUpdating] = useState(false);

  // Guard the entire edit-range flow: hold while the sheet or its nested
  // date-picker is open; release only when both are closed.  The combined
  // boolean ensures closing the inner picker while the sheet remains open
  // does not prematurely release the guard.
  useModalGuard(editRangeOpen || editPickerOpen, holdInteraction, releaseInteraction);

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
    // Auth token not yet loaded from AsyncStorage — the effect will re-run
    // automatically once authToken becomes available (loadPoll is recreated).
    if (!authToken) return;

    setLoading(true);
    setError(null);
    setNeedsSetup(false);
    setAdhocLinkUnsupported(false);
    setAmbiguousScope(false);

    // Read the last-viewed timestamp BEFORE fetching so we can compare once
    // the payload arrives. Keyed by the squad/event/poll so different polls
    // don't share a timestamp.
    const avKey = `availability_lastviewed_${pollId ?? squadId ?? eventId}`;
    let lastViewedAt: Date | null = null;
    try {
      const stored = await AsyncStorage.getItem(avKey);
      if (stored) lastViewedAt = new Date(Number(stored));
    } catch { /* ignore */ }

    // Abort the request after 15 s to prevent an infinite loading state on
    // slow or unresponsive network conditions.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    try {
      let res: Response;
      if (pollId) {
        // Invite-link flow: open poll directly by ID (no squadId/eventId needed).
        res = await fetch(`${API_BASE}/api/availability/polls/${pollId}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
      } else if (!squadId && !eventId) {
        // Ad-hoc polls have no scope to resolve from — they're only reachable
        // by their own id. A bare `?adhoc=1` (an old link, or a reload after
        // the poll was created) has nothing to open, so say so and offer the
        // one action that makes sense instead of resolving some other poll.
        setData(null);
        setNeedsSetup(false);
        setAdhocLinkUnsupported(true);
        return;
      } else {
        // No pollId: resolve the scope from its ACTIVE poll list rather than
        // /find, which silently returns the newest poll and hides the rest.
        const qs = new URLSearchParams(squadId ? { squadId } : { eventId: eventId ?? "" });
        const listRes = await fetch(`${API_BASE}/api/availability/polls?${qs.toString()}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        if (!listRes.ok) {
          const body = (await listRes.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Could not load availability.");
          return;
        }
        const list = (await listRes.json()) as { polls?: { id: string }[] };
        const active = list.polls ?? [];
        if (active.length === 0) {
          setData(null);
          setNeedsSetup(true);
          try { await AsyncStorage.setItem(avKey, String(Date.now())); } catch { /* ignore */ }
          return;
        }
        if (active.length > 1) {
          // Never guess which board the user meant — make them pick.
          setData(null);
          setNeedsSetup(false);
          setAmbiguousScope(true);
          return;
        }
        res = await fetch(`${API_BASE}/api/availability/polls/${active[0].id}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
      }
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
      const raw = (await res.json().catch(() => null)) as unknown;
      if (!raw || typeof raw !== "object" || !("poll" in raw) || !(raw as PollPayload).poll?.id) {
        setError("Could not load availability.");
        return;
      }
      // Terminal: this poll already became a plan. A share link must still
      // resolve, but as a read-only "here's the plan" card — not a grid whose
      // answers can never be read by anyone.
      if ((raw as { converted?: boolean }).converted) {
        const terminal = raw as { convertedEventId?: string | null; convertedEventType?: string | null };
        setConvertedEventId(terminal.convertedEventId ?? null);
        setConvertedEventType(terminal.convertedEventType ?? null);
        setData(null);
        setNeedsSetup(false);
        return;
      }
      const payload = raw as PollPayload;
      setConvertedEventId(null);
      setConvertedEventType(null);
      setData(payload);
      setMySet(new Set(payload.myCells ?? []));
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Request timed out. Check your connection and try again.");
      } else {
        setError("Network error. Please try again.");
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [authToken, authHeaders, squadId, eventId, pollId, currentUser]);

  // B7: poll-resolution nudge — when the creator's poll has a clear winner
  // (2+ people free), nudge them once to lock it in.
  //
  // A length-aware trip poll must be judged on its STRETCH, never on the
  // compatibility single-cell `best`: that cell is one day, so nudging with it
  // would announce "you've got a winner" for a single date of a multi-day trip
  // — and would fire even when bestStretch.partial says nobody can actually
  // make the whole run. Legacy trips (no recorded length) and event polls keep
  // the single-cell nudge, which is the right answer for them.
  useEffect(() => {
    if (!data?.poll) return;
    if (data.poll.createdBy !== currentUser?.id) return;

    const stretch = data.bestStretch ?? null;
    if (
      !shouldNudgePollWinner({
        isCreator: true,
        tripLengthDays: loadedTripLength,
        stretch,
        best: data.best,
      })
    ) {
      return;
    }

    let title: string;
    let subtitle: string;
    if (loadedTripLength) {
      if (!stretch) return;
      const range =
        stretch.startDate === stretch.endDate
          ? prettyDay(stretch.startDate)
          : `${prettyDay(stretch.startDate)} – ${prettyDay(stretch.endDate)}`;
      title = "You've got a winner! 🎯";
      subtitle = `${range} works for ${stretch.count}/${stretch.total}. Tap to lock it in.`;
    } else {
      if (!data.best || data.best.count < 2) return;
      title = "You've got a winner! 🎯";
      subtitle = `${prettyCell(data.best.cell)} works for ${data.best.count}/${data.best.total}. Tap to lock it in.`;
    }

    const thePollId = data.poll.id;
    void (async () => {
      if (await claimOnce(`pollnudge_${thePollId}`, currentUser?.id)) {
        showBanner({ title, subtitle, emoji: "🗓️", durationMs: 6000 });
      }
    })();
  }, [data, currentUser?.id, showBanner, loadedTripLength]);

  const createPoll = useCallback(async () => {
    if (rangeCustomError || tripCustomError) {
      Alert.alert("Check your custom dates", rangeCustomError ?? tripCustomError ?? "Please choose a valid timeline.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // The type must have been answered by now — the wizard can't reach its
      // last step otherwise — but never guess if it somehow wasn't.
      if (!chosenKind) {
        Alert.alert("Pick a type first", "Choose whether this is an event or a trip.");
        return;
      }
      const days = computeRange(rangeStart, rangeDays);
      const slots = isTrip ? TRIP_SLOTS : ALL_SLOT_OPTIONS.filter(s => selectedSlots.has(s));
      const scope: Record<string, unknown> = adhoc
        ? { adhoc: true, participantIds }
        : squadId
          ? { squadId }
          : { eventId };
      // "Find a time" / event-planning flows always start a brand-new poll
      // rather than reopening this scope's last (possibly stale) board.
      const body: Record<string, unknown> = {
        ...scope,
        days,
        slots,
        // Explicit type, chosen by the user rather than inferred from the entry
        // point or from the slots.
        kind: chosenKind,
        // Duration rides on both kinds. It is omitted for a ONE-DAY plan, which
        // is what keeps a normal event on the single-best-time answer; the
        // voting window (`days`) is a separate span and must not be confused
        // with it.
        ...(() => {
          const n = createPlanLengthValue(tripLength);
          return n === undefined ? {} : { tripLengthDays: n };
        })(),
        ...(fromCreate ? { forceNew: true } : {}),
      };
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
      // The draft has become a real poll — drop it so a later visit to this
      // scope starts clean instead of resurrecting the just-used setup.
      void clearPollDraft(draftScopeKey);
      // Swap the create-flow URL (…?eventId=…&from=create) for the canonical
      // poll URL so a web refresh reopens the created poll instead of dropping
      // the user back onto the empty setup form.
      leaveAfterSuccess(() =>
        router.replace({ pathname: "/availability", params: { pollId: payload.poll.id } } as never),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert("Couldn't create poll", "Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [authHeaders, squadId, eventId, adhoc, fromCreate, isTrip, chosenKind, tripLength, params.participantIds, pollTitle, rangeStart, rangeDays, selectedSlots, leaveAfterSuccess, draftScopeKey, rangeCustomError, tripCustomError]);

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
      // ALWAYS refresh the poll that is actually open, by its id.
      //
      // This used to fall back to /find whenever the screen was opened without
      // a pollId param, which resolves the scope's NEWEST poll: if anyone
      // started another poll for the same squad while you sat on yours, your
      // grid silently swapped to a different board underneath you and your
      // picks were saved against the wrong poll.
      const openPollId = openPollIdRef.current;
      if (!openPollId) return;
      const res = await fetch(`${API_BASE}/api/availability/polls/${openPollId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const payload = (await res.json()) as PollPayload & {
        converted?: boolean;
        convertedEventId?: string | null;
      };
      // The host locked this poll in while we were looking at it: drop straight
      // to the terminal state instead of leaving an editable grid whose saves
      // would now be rejected.
      if (payload.converted) {
        setConvertedEventId(payload.convertedEventId ?? null);
        setData(null);
        return;
      }
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
  }, [authHeaders, squadId, eventId, pollId, showUpdateIndicator, currentUser]);

  // Live updates: subscribe to the poll's SSE stream so changes (a member
  // submits, the host edits the range, or a nudge) reflect immediately. The
  // 20-second polling interval below stays as a fallback if the stream drops.
  useAvailabilityStream({
    pollId: data?.poll.id ?? pollId ?? null,
    authToken,
    onUpdate: () => { void refreshInBackground(); },
  });

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
    const slots = new Set((data.poll.slots as string[]) ?? DEFAULT_SLOTS);
    const title = data.poll.title ?? "";
    setEditStart(d ?? new Date());
    setEditDays(data.poll.days.length);
    setEditSlots(slots);
    setEditTitle(title);
    // A legacy trip poll has no stored length, and opening the editor must not
    // invent one (see initialEditTripLength): seeding the control with a default
    // made the sheet dirty before the host touched anything, warned about
    // "unsaved changes" on Cancel, and let Save quietly convert the poll to
    // stretch-ranking. Null in, null out.
    const currentTripLength = loadedTripLength;
    setEditTripLength(initialEditTripLength(currentTripLength, data.poll.days.length));
    // Snapshot what the sheet opened with so Cancel can tell "nothing changed"
    // from "you're about to throw away a re-range".
    editBaselineRef.current = editRangeSnapshot({
      startISO: toISODate(d ?? new Date()),
      days: data.poll.days.length,
      slots,
      title,
      tripLengthDays: currentTripLength,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditRangeOpen(true);
  }, [data, loadedTripLength]);

  const editSnapshot = useMemo(
    () =>
      editRangeSnapshot({
        startISO: toISODate(editStart),
        days: editDays,
        slots: editSlots,
        title: editTitle,
        // Duration is editable on BOTH kinds now, so it has to participate in
        // the dirty check for both. Pinning it to null on events meant changing
        // an event's length didn't count as a change: Save stayed disabled and
        // the edit was silently discarded.
        tripLengthDays: editTripLength,
      }),
    [editStart, editDays, editSlots, editTitle, editTripLength],
  );

  /** True when the edit sheet holds changes that Cancel would discard. */
  const editRangeIsDirty = useMemo(
    () => editRangeDirty(editSnapshot, editBaselineRef.current),
    [editSnapshot],
  );

  /**
   * True only when the DATES or SLOTS changed. Changing just the trip length
   * re-ranks the existing `<date>-All day` cells — nothing moves out of the
   * grid, so there is nothing to trim and no loss to confirm.
   */
  const editTouchesGrid = useMemo(
    () => editChangesGrid(editSnapshot, editBaselineRef.current),
    [editSnapshot],
  );

  /**
   * Cancelling the edit sheet silently dropped a re-range the host had just
   * dialled in — including a fat-fingered backdrop tap. Confirm first when
   * anything actually changed.
   */
  const closeEditRange = useCallback(() => {
    if (!editRangeIsDirty) {
      setEditRangeOpen(false);
      return;
    }
    Alert.alert(
      "Discard these changes?",
      "Your new date range hasn't been saved.",
      [
        { text: "Keep editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => setEditRangeOpen(false) },
      ],
    );
  }, [editRangeIsDirty]);

  // What the pending edit would delete. The server trims silently, so the
  // organizer sees the cost — how many selections and how many people — before
  // they commit, not after.
  const pendingEditLoss = useMemo(() => {
    if (!data) return { droppedSelections: 0, affectedUserIds: [] as string[], affectedPeople: 0 };
    // A duration-only edit can't drop anything — skip the scan so the confirm
    // dialog never claims answers are about to be erased when they aren't.
    if (!editTouchesGrid) {
      return { droppedSelections: 0, affectedUserIds: [] as string[], affectedPeople: 0 };
    }
    const nextDays = computeRange(editStart, editDays);
    const keptSlots = ALL_SLOT_OPTIONS.filter((s) => editSlots.has(s));
    const nextSlots = keptSlots.length > 0 ? keptSlots : data.poll.slots;
    if (data.memberCells && data.memberCells.length > 0) {
      return computeTrimLoss({ memberCells: data.memberCells, nextDays, nextSlots });
    }
    // memberCells is omitted for large polls — fall back to the heatmap, which
    // still gives an accurate selection count (just not per-person attribution).
    const { droppedSelections } = computeTrimLossFromHeatmap({
      heatmap: data.heatmap,
      nextDays,
      nextSlots,
    });
    return { droppedSelections, affectedUserIds: [] as string[], affectedPeople: 0 };
  }, [data, editStart, editDays, editSlots, editTouchesGrid]);

  const doUpdateRange = useCallback(async () => {
    if (!data) return;
    setUpdating(true);
    try {
      const patchBody: Record<string, unknown> = {};
      // Send the grid ONLY when it actually changed. A duration-only save that
      // re-sent identical days/slots would make the server run its trim pass
      // and fire "the host changed the dates" pushes for a change that never
      // touched anyone's answers.
      if (editTouchesGrid) {
        const days = computeRange(editStart, editDays);
        const slots = ALL_SLOT_OPTIONS.filter((s) => editSlots.has(s));
        patchBody.days = days;
        if (slots.length > 0) patchBody.slots = slots;
      }
      patchBody.title = editTitle.trim();
      // Three distinct outcomes, and the difference matters on the wire:
      // undefined = don't touch the length (a legacy trip stays length-less),
      // null = CLEAR it (a multi-day event going back to a single day),
      // a number = set it. Only `undefined` may be dropped from the body.
      const tripLengthPatch = editTripLengthPatchValue({
        editTripLength,
        editDays,
        loadedTripLength,
      });
      if (tripLengthPatch !== undefined) patchBody.tripLengthDays = tripLengthPatch;
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
  }, [data, authHeaders, editTitle, editStart, editDays, editSlots, editTouchesGrid, editTripLength]);

  const updateRange = useCallback(() => {
    if (!data) return;
    if (pendingEditLoss.droppedSelections === 0) {
      void doUpdateRange();
      return;
    }
    const detail =
      pendingEditLoss.affectedPeople > 0
        ? trimLossMessage(pendingEditLoss)
        : `${pendingEditLoss.droppedSelections} ${pendingEditLoss.droppedSelections === 1 ? "selection falls" : "selections fall"} outside the new range and will be removed.`;
    Alert.alert("This will erase some answers", detail, [
      { text: "Keep editing", style: "cancel" },
      { text: "Save anyway", style: "destructive", onPress: () => void doUpdateRange() },
    ]);
  }, [data, pendingEditLoss, doUpdateRange]);

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
    if (!squadId && !eventId && !pollId && !adhoc) {
      setError("Missing squad, event, or poll.");
      setLoading(false);
      return;
    }
    // Coming from event creation: skip loading any prior poll and let the user
    // set up a fresh date range for this new event.
    if (fromCreate) {
      setData(null);
      setNeedsSetup(true);
      setError(null);
      setLoading(false);
      return;
    }
    void loadPoll();
  }, [loadPoll, squadId, eventId, pollId, fromCreate]);

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

  // Guards against a long-press (which opens the details sheet) ALSO firing the
  // short-press toggle on release. Reset at the start of every touch via onPressIn.
  const longPressFiredRef = useRef(false);

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
      setJustSaved(true);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // User just submitted their availability — clear the range-updated banner.
      setRangeUpdatedBanner(false);
    } catch {
      Alert.alert("Couldn't save", "Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // `cell` defaults to the computed best time, but the in-poll alternate picker
  // passes any other cell from THIS poll so choosing a runner-up keeps every
  // downstream behaviour (event PATCH, poll conversion, trip vs event choice)
  // identical instead of dumping the user into an empty create form.
  const useThisTime = async (cellOverride?: string) => {
    const cell = cellOverride ?? data?.best?.cell;
    if (!data || !cell) return;
    const friendly = prettyCell(cell);
    const eventAtISO = cellToISO(cell);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (eventId) {
      try {
        const res = await fetch(`${API_BASE}/api/events/${eventId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ date: friendly, ...(eventAtISO ? { eventAt: eventAtISO } : {}) }),
        });
        if (res.ok) {
          // The event now carries the winning time — mark this poll converted so
          // it drops out of the squad/personal "Existing" lists.
          if (data?.poll.id) {
            fetch(`${API_BASE}/api/availability/polls/${data.poll.id}/convert`, {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({ eventId }),
            }).catch(() => {});
          }
          Alert.alert("Time locked in", `${friendly} is now the event time.`, [
            {
              text: "Done",
              onPress: () =>
                leaveAfterSuccess(() =>
                  router.canGoBack() ? router.back() : router.replace("/(tabs)" as never),
                ),
            },
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
    // Squad / personal / ad-hoc flow → the poll isn't bound to anything yet, so
    // send the winning cell through to the create form. The pollId rides along
    // so create.tsx marks the poll converted once the plan is made.
    //
    // The poll's OWN kind decides where this lands. It used to pop an "Event or
    // Trip?" prompt here, which asked the creator to re-decide something they
    // already answered when they made the poll — and, worse, let a trip poll's
    // result become an event (and vice versa) by a stray tap.
    const dayISO = splitCell(cell).day;
    const tripStartDay = parseISODate(dayISO) ? dayISO : undefined;
    router.push({
      pathname: "/create",
      params: {
        prefillSquad: squadId ?? "",
        ...(data?.poll.id ? { prefillPollId: data.poll.id } : {}),
        ...(isTrip
          ? { mode: "trip", ...(tripStartDay ? { prefillTripStart: tripStartDay } : {}) }
          : { prefillDate: friendly, ...(eventAtISO ? { prefillEventAt: eventAtISO } : {}) }),
      },
    } as never);
  };

  /**
   * Lock in a RUN of days rather than a single cell — the answer any
   * duration-aware poll gives, event or trip.
   *
   * Deliberately does not offer the "Event or Trip?" fork that `useThisTime`
   * does. That fork existed because a single winning cell is ambiguous; a
   * duration-aware poll is not — the creator already said which kind of plan
   * they were scheduling, so asking again would be re-litigating a decision
   * they made at the start. The poll's own kind decides where this lands.
   *
   * The pollId still rides along so the server claims the poll inside the
   * create transaction.
   */
  const useThisStretch = async (startDate: string, endDate: string) => {
    if (!data) return;
    const startOk = parseISODate(startDate) !== null;
    const endOk = parseISODate(endDate) !== null;
    if (!startOk || !endOk) return;
    const friendly =
      startDate === endDate
        ? prettyDay(startDate)
        : `${prettyDay(startDate)} – ${prettyDay(endDate)}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // A multi-day EVENT still has times on its grid, so the winning stretch
    // carries the best time on those days rather than a trip's 09:00–18:00
    // placeholder. Falls back to the placeholder when nobody picked a slot.
    const bestSlot = !isTrip && data.best?.cell ? splitCell(data.best.cell).slot : null;
    const startISO = (() => {
      if (bestSlot) {
        const iso = cellToISO(`${startDate}-${bestSlot}`);
        if (iso) return iso;
      }
      return new Date(`${startDate}T09:00:00`).toISOString();
    })();
    const endISO = new Date(`${endDate}T18:00:00`).toISOString();

    // Bound to an existing event/trip: update its dates in place rather than
    // creating a second plan alongside it.
    if (eventId) {
      try {
        const res = await fetch(`${API_BASE}/api/events/${eventId}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ date: friendly, startAt: startISO, endAt: endISO }),
        });
        if (res.ok) {
          if (data.poll.id) {
            fetch(`${API_BASE}/api/availability/polls/${data.poll.id}/convert`, {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({ eventId }),
            }).catch(() => {});
          }
          Alert.alert("Dates locked in", `${friendly} is now the ${planNoun(isTrip ? "trip" : "event")}.`, [
            {
              text: "Done",
              onPress: () =>
                leaveAfterSuccess(() =>
                  router.canGoBack() ? router.back() : router.replace("/(tabs)" as never),
                ),
            },
          ]);
        } else if (res.status === 403) {
          Alert.alert("Host only", "Only the host can change the dates.");
        } else {
          Alert.alert("Couldn't update", "Please try again.");
        }
      } catch {
        Alert.alert("Couldn't update", "Network error. Please try again.");
      }
      return;
    }

    router.push({
      pathname: "/create",
      params: {
        prefillSquad: squadId ?? "",
        ...(data.poll.id ? { prefillPollId: data.poll.id } : {}),
        // A trip becomes a trip; a multi-day EVENT stays an event and carries
        // its winning run as a start/end pair, so the creator doesn't have to
        // re-enter the dates their squad just voted for.
        ...(isTrip
          ? { mode: "trip", prefillTripStart: startDate, prefillTripEnd: endDate }
          : {
              prefillDate: friendly,
              prefillEventAt: startISO,
              prefillEndAt: endISO,
            }),
      },
    } as never);
  };

  // Creator-only: delete the poll and everyone's responses, then leave the screen.
  const deletePoll = () => {
    if (!data?.poll.id) return;
    const pollIdToDelete = data.poll.id;
    const doDelete = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/availability/polls/${pollIdToDelete}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (res.ok) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          leaveAfterSuccess(() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)" as never),
          );
        } else if (res.status === 403) {
          Alert.alert("Creator only", "Only the person who started this poll can delete it.");
        } else {
          Alert.alert("Couldn't delete", "Please try again.");
        }
      } catch {
        Alert.alert("Couldn't delete", "Network error. Please try again.");
      }
    };
    Alert.alert("Delete poll?", "This removes the poll and everyone's responses. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void doDelete() },
    ]);
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

  // Full range of the loaded poll, shown in the header for every range length.
  const pollRangeLabel = useMemo(() => {
    const days = data?.poll.days ?? [];
    if (days.length === 0) return null;
    const first = days[0];
    const last = days[days.length - 1];
    return days.length === 1 ? prettyDay(first) : `${prettyDay(first)} – ${prettyDay(last)}`;
  }, [data?.poll.days]);

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

  const sharePoll = useCallback(async () => {
    if (!data) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const title = data.poll.title || "Find the Best Time";
    const link = `https://joinsquadz.com/availability?pollId=${data.poll.id}`;
    const message = `Help me find the best time — fill in your availability on SquadZ!\n\n${link}`;
    try {
      await Share.share(Platform.OS === "ios" ? { message, url: link } : { message });
    } catch { /* user cancelled */ }
  }, [data]);

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
          {/* The poll's full date range lives here rather than only in the
              day-pager, which is hidden for short ranges — otherwise a 3-day
              poll never states which dates it covers. */}
          {pollRangeLabel ? (
            <Text style={[styles.renamedByText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {pollRangeLabel}
            </Text>
          ) : null}
          {data?.poll.updatedAt && data.poll.updatedByName ? (
            <Text style={[styles.renamedByText, { color: colors.mutedForeground }]} numberOfLines={1}>
              Renamed by {data.poll.updatedByName} · {formatUpdatedDate(data.poll.updatedAt)}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          {data && (
            <TouchableOpacity onPress={() => void sharePoll()} style={styles.headerActionBtn} hitSlop={8}>
              <Ionicons name="share-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
          {isCreator && (
            <TouchableOpacity onPress={openEditRange} style={styles.headerActionBtn} hitSlop={8}>
              <Ionicons name="calendar-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
          {isCreator && data && (
            <TouchableOpacity onPress={() => deletePoll()} style={styles.headerActionBtn} hitSlop={8}>
              <Ionicons name="trash-outline" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        // T212: skeleton mirroring the poll layout (title block + day-grid
        // columns) instead of a bare spinner.
        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 14 }}>
          <SkeletonBox height={22} width="60%" borderRadius={8} />
          <SkeletonBox height={14} width="40%" borderRadius={7} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ flex: 1, gap: 6 }}>
                <SkeletonBox height={12} borderRadius={6} />
                <SkeletonBox height={220} borderRadius={10} />
              </View>
            ))}
          </View>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textDim} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{error}</Text>
          <TouchableOpacity onPress={() => void loadPoll()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : convertedEventId !== null ? (
        // Terminal state. The poll did its job and became a plan; a shared link
        // still resolves, but as a signpost to the plan rather than a grid
        // whose answers can no longer change anything.
        <View style={styles.center}>
          <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
          <Text style={[styles.terminalTitle, { color: colors.foreground }]}>This poll is closed</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            A time was picked and the plan is on the calendar.
          </Text>
          <TouchableOpacity
            onPress={() =>
              router.push(
                (convertedEventType === "trip"
                  ? `/trip/${convertedEventId}`
                  : `/event/${convertedEventId}`) as never,
              )
            }
            style={[styles.retryBtn, { borderColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>View the plan</Text>
          </TouchableOpacity>
        </View>
      ) : ambiguousScope ? (
        // 2+ active polls for this squad/event. Auto-opening "the newest" is how
        // people ended up answering the wrong board, so make the choice explicit.
        <View style={styles.center}>
          <Ionicons name="layers-outline" size={44} color={colors.textDim} />
          <Text style={[styles.terminalTitle, { color: colors.foreground }]}>More than one poll is running</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            Pick the one you want so you don&apos;t answer the wrong board.
          </Text>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
            style={[styles.retryBtn, { borderColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>Choose a poll</Text>
          </TouchableOpacity>
        </View>
      ) : adhocLinkUnsupported ? (
        // An ad-hoc poll belongs to no squad or event, so there is nothing to
        // resolve from a bare ?adhoc=1 link. Say that plainly instead of
        // showing an empty board or silently opening someone else's poll.
        <View style={styles.center}>
          <Ionicons name="link-outline" size={44} color={colors.textDim} />
          <Text style={[styles.terminalTitle, { color: colors.foreground }]}>This link needs a poll</Text>
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            One-off polls open from their own link. Ask whoever created it to share it again, or start a new one.
          </Text>
          <TouchableOpacity
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
            style={[styles.retryBtn, { borderColor: colors.primary }]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>Go back</Text>
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
                colors={["#FF6B2C", "#FF8050"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.setupHeroCard}
              >
                <View style={styles.heroIcon}>
                  <Ionicons name="sparkles" size={22} color="#fff" />
                </View>
                <Text style={styles.setupHeroTitle}>
                  {isTrip ? "Find the dates that work for everyone" : "Find the time that works for everyone"}
                </Text>
                <Text style={styles.setupHeroSub}>
                  {isTrip
                    ? "Set a date range, everyone marks the days they're free, and we surface the best dates automatically."
                    : "Set a date range, everyone taps when they're free, and we surface the best time automatically."}
                </Text>
              </LinearGradient>
            </View>

            {/* Step indicator — one decision per screen. */}
            <View style={styles.wizardSteps}>
              {wizardSteps.map((s, i) => {
                const done = i < wizardStep;
                const active = i === wizardStep;
                return (
                  <View key={s.id} style={styles.wizardStepItem}>
                    <View
                      style={[
                        styles.wizardStepDot,
                        {
                          backgroundColor: active || done ? colors.primary : colors.card,
                          borderColor: active || done ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      {done ? (
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      ) : (
                        <Text style={[styles.wizardStepNum, { color: active ? "#fff" : colors.mutedForeground }]}>
                          {i + 1}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[
                        styles.wizardStepLabel,
                        { color: active ? colors.foreground : colors.mutedForeground },
                      ]}
                    >
                      {s.label}
                    </Text>
                    {i < wizardSteps.length - 1 && (
                      <View style={[styles.wizardStepBar, { backgroundColor: done ? colors.primary : colors.border }]} />
                    )}
                  </View>
                );
              })}
            </View>

            {draftRestored && (
              <View style={[styles.draftBanner, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
                <Ionicons name="refresh-outline" size={16} color={colors.primary} />
                <Text style={[styles.draftBannerText, { color: colors.foreground }]}>
                  Picked up where you left off.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync();
                    setPollTitle("");
                    setRangeStart(new Date());
                    setRangeDays(DEFAULT_DAY_COUNT);
                    setRangeDaysChoice("preset");
                    setCustomRangeDays(String(DEFAULT_DAY_COUNT));
                    setSelectedSlots(new Set(DEFAULT_SLOTS));
                    setSlotPeriod("Evening");
                    setTripLength(DEFAULT_TRIP_LENGTH_DAYS);
                    setTripLengthChoice("preset");
                    setCustomTripLength(String(DEFAULT_TRIP_LENGTH_DAYS));
                    // Starting over includes the type answer, unless the entry
                    // point supplied one (there is nothing to re-ask then).
                    setChosenKind(paramKind ?? null);
                    setWizardStep(0);
                    setDraftRestored(false);
                    void clearPollDraft(draftScopeKey);
                  }}
                  hitSlop={8}
                >
                  <Text style={[styles.draftBannerAction, { color: colors.primary }]}>Start over</Text>
                </TouchableOpacity>
              </View>
            )}

            {currentStepId === "type" && (
              <>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  What are you planning? This decides how people vote and what the
                  poll answers with — you can&apos;t change it later, so pick the one
                  you mean.
                </Text>

                {([
                  {
                    kind: "event" as PollKind,
                    icon: "calendar-outline" as const,
                    title: "Event",
                    blurb: "A get-together with a start time. People vote on the times of day that work.",
                  },
                  {
                    kind: "trip" as PollKind,
                    icon: "airplane-outline" as const,
                    title: "Trip",
                    blurb: "Days away. People just mark the dates they could travel — no times.",
                  },
                ]).map((opt) => {
                  const active = chosenKind === opt.kind;
                  return (
                    <TouchableOpacity
                      key={opt.kind}
                      onPress={() => {
                        stampInteraction();
                        Haptics.selectionAsync();
                        chosenKindRef.current = opt.kind;
                        kindSelectionTouchedRef.current = true;
                        setChosenKind(opt.kind);
                      }}
                      style={[
                        styles.kindCard,
                        {
                          backgroundColor: active ? colors.primary + "18" : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${opt.title} poll`}
                    >
                      <View
                        style={[
                          styles.kindCardIcon,
                          { backgroundColor: active ? colors.primary : colors.background },
                        ]}
                      >
                        <Ionicons name={opt.icon} size={20} color={active ? "#fff" : colors.mutedForeground} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.kindCardTitle, { color: colors.foreground }]}>{opt.title}</Text>
                        <Text style={[styles.kindCardBlurb, { color: colors.mutedForeground }]}>{opt.blurb}</Text>
                      </View>
                      {active && <Ionicons name="checkmark-circle" size={22} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}

                <Text style={[styles.wizardHint, { color: colors.textDim }]}>
                  Either one can run for more than a day — you&apos;ll pick how long on
                  the next steps.
                </Text>
              </>
            )}

            {currentStepId === "name" && (
              <>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  Give this a name so your squad knows what they&apos;re marking availability for. You can skip it.
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
              </>
            )}

            {currentStepId === "dates" && (
              <>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  Pick the dates everyone should mark their availability for. You can plan for this week or further out.
                </Text>

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
                    const active = rangeDaysChoice === "preset" && rangeDays === n;
                    return (
                      <TouchableOpacity
                        key={n}
                        onPress={() => {
                          stampInteraction();
                          Haptics.selectionAsync();
                          setRangeDays(n);
                          setRangeDaysChoice("preset");
                          setCustomRangeDays(String(n));
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
                  <TouchableOpacity
                    onPress={() => {
                      stampInteraction();
                      Haptics.selectionAsync();
                      setRangeDaysChoice("custom");
                      setCustomRangeDays(String(rangeDays));
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: rangeDaysChoice === "custom" ? colors.primary : colors.card,
                        borderColor: rangeDaysChoice === "custom" ? colors.primary : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Choose a custom voting window"
                  >
                    <Text style={[styles.chipText, { color: rangeDaysChoice === "custom" ? "#fff" : colors.foreground }]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {rangeDaysChoice === "custom" && (
                  <>
                    <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: rangeCustomError ? colors.destructive : colors.primary, marginTop: 10 }]}>
                      <Ionicons name="calendar-number-outline" size={18} color={rangeCustomError ? colors.destructive : colors.primary} />
                      <TextInput
                        value={customRangeDays}
                        onChangeText={(text) => {
                          setCustomRangeDays(text);
                          if (!customDayCountError(text)) setRangeDays(Number(text.trim()));
                        }}
                        keyboardType="number-pad"
                        returnKeyType="done"
                        placeholder={`1–${MAX_POLL_DAY_COUNT}`}
                        placeholderTextColor={colors.textDim}
                        style={[styles.dateBtnText, { color: colors.foreground }]}
                        accessibilityLabel="Custom voting window days"
                      />
                      <Text style={[styles.chipText, { color: colors.mutedForeground }]}>days</Text>
                    </View>
                    <Text style={[styles.wizardHint, { color: rangeCustomError ? colors.destructive : colors.textDim }]}>
                      {rangeCustomError ?? `Choose any whole-day window from 1 to ${MAX_POLL_DAY_COUNT} days.`}
                    </Text>
                  </>
                )}

                <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                  <Ionicons name="time-outline" size={16} color={colors.primary} />
                  <Text style={[styles.previewText, { color: colors.foreground }]}>{rangePreview}</Text>
                </View>
              </>
            )}

            {currentStepId === "length" && (
              <>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  {isTrip
                    ? "How long is the trip itself? Everyone marks every date they could travel across the range above, and we find the best run of days inside it."
                    : "How long does the event run? Most are a single day. Pick more and we'll find the best run of days inside the range above instead of one best time."}
                </Text>

                <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>
                  {isTrip ? "Trip length" : "Event length"}
                </Text>
                <View style={styles.chipRow}>
                  {planLengthOptionsFor(rangeDays, isTrip ? "trip" : "event").map((n) => {
                    const active = tripLengthChoice === "preset" && tripLength === n;
                    return (
                      <TouchableOpacity
                        key={`plan-len-${n}`}
                        onPress={() => {
                          stampInteraction();
                          Haptics.selectionAsync();
                          setTripLength(n);
                          setTripLengthChoice("preset");
                          setCustomTripLength(String(n));
                        }}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: active ? colors.primary : colors.card,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                          {n === 1 ? "1 day" : `${n} days`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => {
                      stampInteraction();
                      Haptics.selectionAsync();
                      setTripLengthChoice("custom");
                      setCustomTripLength(String(tripLength));
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: tripLengthChoice === "custom" ? colors.primary : colors.card,
                        borderColor: tripLengthChoice === "custom" ? colors.primary : colors.border,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose a custom ${planNoun(isTrip ? "trip" : "event")} length`}
                  >
                    <Text style={[styles.chipText, { color: tripLengthChoice === "custom" ? "#fff" : colors.foreground }]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {tripLengthChoice === "custom" && (
                  <>
                    <View style={[styles.dateBtn, { backgroundColor: colors.card, borderColor: tripCustomError ? colors.destructive : colors.primary, marginTop: 10 }]}>
                      <Ionicons name="calendar-number-outline" size={18} color={tripCustomError ? colors.destructive : colors.primary} />
                      <TextInput
                        value={customTripLength}
                        onChangeText={(text) => {
                          setCustomTripLength(text);
                          if (!customPlanLengthError(text, rangeDays, isTrip ? "trip" : "event")) {
                            setTripLength(Number(text.trim()));
                          }
                        }}
                        keyboardType="number-pad"
                        returnKeyType="done"
                        placeholder={`${minPlanLength(isTrip ? "trip" : "event")}–${rangeDays}`}
                        placeholderTextColor={colors.textDim}
                        style={[styles.dateBtnText, { color: colors.foreground }]}
                        accessibilityLabel={`Custom ${planNoun(isTrip ? "trip" : "event")} length days`}
                      />
                      <Text style={[styles.chipText, { color: colors.mutedForeground }]}>days</Text>
                    </View>
                    <Text style={[styles.wizardHint, { color: tripCustomError ? colors.destructive : colors.textDim }]}>
                      {tripCustomError ??
                        `Your ${planNoun(isTrip ? "trip" : "event")} can be ${minPlanLength(isTrip ? "trip" : "event")} to ${rangeDays} days inside this voting window.`}
                    </Text>
                  </>
                )}
                {planLengthOptionsFor(rangeDays, isTrip ? "trip" : "event").length === 0 && (
                  <Text style={[styles.wizardHint, { color: colors.textDim }]}>
                    Go back and pick at least {minPlanLength(isTrip ? "trip" : "event")} days to vote across.
                  </Text>
                )}
                {/* A one-day plan has no run to rank, so say plainly which
                    answer they're going to get. */}
                {!isTrip && (
                  <Text style={[styles.wizardHint, { color: colors.textDim }]}>
                    {tripLength <= 1
                      ? "We'll find the single best day and time."
                      : `We'll find the best ${tripLength} days in a row, then the best time on those days.`}
                  </Text>
                )}

                <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                  <Text style={[styles.previewText, { color: colors.foreground }]}>
                    {wizardReviewLine({
                      title: pollTitle,
                      rangeLabel: rangePreview,
                      slotCount: selectedSlots.size,
                      isTrip,
                      tripLengthDays: tripLength,
                    })}
                  </Text>
                </View>
              </>
            )}

            {currentStepId === "times" && (
              <>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                  Choose which times of day people can pick from. Switch tabs to add slots from other parts of the day.
                </Text>

                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={[styles.setupLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>Time slots</Text>
                  <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{selectedSlots.size} selected</Text>
                </View>
                <View style={[styles.chipRow, { marginBottom: 8 }]}>
                  {SLOT_PERIODS.map((p) => {
                    // Surface how many picks live under each tab so selections
                    // made elsewhere are never invisible.
                    const inPeriod = [...selectedSlots].filter((s) => periodForSlot(s) === p.label).length;
                    return (
                      <TouchableOpacity
                        key={p.label}
                        onPress={() => { stampInteraction(); Haptics.selectionAsync(); setSlotPeriod(p.label); }}
                        style={[styles.chip, { backgroundColor: slotPeriod === p.label ? colors.primary : colors.card, borderColor: slotPeriod === p.label ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.chipText, { color: slotPeriod === p.label ? "#fff" : colors.foreground }]}>
                          {p.label}{inPeriod > 0 ? ` · ${inPeriod}` : ""}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.chipRow}>
                  {(SLOT_PERIODS.find(p => p.label === slotPeriod)?.slots ?? SLOT_PERIODS[3].slots).map((s) => {
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

                {/* Every current selection, including ones from other tabs. */}
                <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>Your selected times</Text>
                <View style={styles.chipRow}>
                  {sortSlotsChronologically(selectedSlots).map((s) => (
                    <TouchableOpacity
                      key={`sel-${s}`}
                      onPress={() => {
                        stampInteraction();
                        Haptics.selectionAsync();
                        setSelectedSlots((prev) => {
                          const next = new Set(prev);
                          if (next.size > 1) next.delete(s);
                          return next;
                        });
                      }}
                      style={[styles.selectedSlotChip, { backgroundColor: colors.primary + "1F", borderColor: colors.primary + "66" }]}
                    >
                      <Text style={[styles.chipText, { color: colors.primary }]}>{s}</Text>
                      <Ionicons name="close" size={13} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
                {selectionsOutsidePeriod(selectedSlots, slotPeriod) > 0 && (
                  <Text style={[styles.wizardHint, { color: colors.textDim }]}>
                    {selectionsOutsidePeriod(selectedSlots, slotPeriod)} of these are on other tabs.
                  </Text>
                )}

                <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                  <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                  <Text style={[styles.previewText, { color: colors.foreground }]}>
                    {wizardReviewLine({
                      title: pollTitle,
                      rangeLabel: rangePreview,
                      slotCount: selectedSlots.size,
                      isTrip,
                    })}
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={[styles.bottomBar, { borderTopColor: colors.border, paddingBottom: botPad + 12, backgroundColor: colors.background }]}>
            <View style={styles.wizardNavRow}>
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  if (wizardStep <= 0) {
                    router.canGoBack() ? router.back() : router.replace("/(tabs)" as never);
                  } else {
                    setWizardStep((i) => prevWizardStep(i));
                  }
                }}
                style={[styles.wizardBackBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Ionicons name="chevron-back" size={16} color={colors.foreground} />
                <Text style={[styles.wizardBackText, { color: colors.foreground }]}>
                  {wizardStep <= 0 ? "Cancel" : "Back"}
                </Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                {isLastWizardStep(wizardStep, isTrip, needsKindStep) ? (
                  <GradientButton
                    label={creating ? "Creating…" : "Create poll"}
                    onPress={() => void createPoll()}
                    disabled={
                      creating ||
                      !chosenKind ||
                      !canAdvanceWizard(wizardStep, isTrip, {
                        slotCount: selectedSlots.size,
                        tripLengthDays: tripLength,
                        rangeDays,
                        kindChosen: chosenKind !== null,
                        needsKind: needsKindStep,
                      }) ||
                      !!rangeCustomError ||
                      !!tripCustomError
                    }
                  />
                ) : (
                  <GradientButton
                    label="Next"
                    onPress={() => {
                      Haptics.selectionAsync();
                      setWizardStep((i) => nextWizardStep(i, isTrip, needsKindStep));
                    }}
                    disabled={
                      !canAdvanceWizard(wizardStep, isTrip, {
                        slotCount: selectedSlots.size,
                        tripLengthDays: tripLength,
                        rangeDays,
                        kindChosen: chosenKind !== null,
                        needsKind: needsKindStep,
                      }) ||
                      !!rangeCustomError ||
                      !!tripCustomError
                    }
                  />
                )}
              </View>
            </View>
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
              {isTrip
                ? loadedTripLength
                  ? `Tap every date you could travel — tap again to clear. We'll find the best ${loadedTripLength} days in a row. Long-press a date to see who's free, or to start the trip there.`
                  : "Tap the dates you're free — tap again to clear. Long-press a date to see who's free. We'll highlight when the most people can go."
                : "Tap the times you're free — tap again to clear. Long-press a slot to see who's free. We'll highlight when the most people can make it."}
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

            {/* Trip result: a RUN of days, not one slot. When nobody clears the
                whole run we say so plainly instead of dressing up the least-bad
                window as a winner — a squad that books on a false "best" finds
                out at the airport. */}
            {data.bestStretch ? (
              <View style={styles.heroWrap}>
                <LinearGradient
                  colors={data.bestStretch.partial ? ["#6B7280", "#8A93A3"] : ["#FF6B2C", "#FF8050"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroCard}
                >
                  <View style={styles.heroIcon}>
                    <Ionicons
                      name={data.bestStretch.partial ? "alert-circle" : "sparkles"}
                      size={20}
                      color="#fff"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroLabel}>
                      {data.bestStretch.partial
                        ? `NO ${data.bestStretch.lengthDays} DAYS WORK FOR EVERYONE`
                        : `BEST ${data.bestStretch.lengthDays} DAYS FOR EVERYONE`}
                    </Text>
                    <Text style={styles.heroValue} numberOfLines={2}>
                      {prettyDay(data.bestStretch.startDate)} – {prettyDay(data.bestStretch.endDate)}
                    </Text>
                    <Text style={styles.heroSubLabel} numberOfLines={2}>
                      {data.bestStretch.partial
                        ? `Nobody is free for all ${data.bestStretch.lengthDays} days. ${data.bestStretch.partialCount} of ${data.bestStretch.total} can make part of this stretch.`
                        : `Free for the whole stretch${
                            data.bestStretch.partialCount > data.bestStretch.count
                              ? ` · ${data.bestStretch.partialCount} of ${data.bestStretch.total} free for part of it`
                              : ""
                          }`}
                    </Text>
                  </View>
                  <View style={styles.heroFreePill}>
                    <Text style={styles.heroFreeCount}>
                      {data.bestStretch.count}/{data.bestStretch.total}
                    </Text>
                    <Text style={styles.heroFreeLabel}>free</Text>
                  </View>
                </LinearGradient>
              </View>
            ) : resultKind === "cell" && data.best ? (
              // Single-cell result — correct for event polls and for legacy
              // trips that never recorded a length. A length-aware trip with no
              // rankable stretch must NOT fall back to this: one day is not an
              // answer to "when can we all go away for N days?".
              <View style={styles.heroWrap}>
                <LinearGradient
                  colors={["#FF6B2C", "#FF8050"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroCard}
                >
                  <View style={styles.heroIcon}>
                    <Ionicons name="sparkles" size={20} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroLabel}>
                      {isTrip ? "BEST DATE FOR EVERYONE" : "BEST TIME FOR EVERYONE"}
                    </Text>
                    <Text style={styles.heroValue} numberOfLines={2}>{prettyCell(data.best.cell)}</Text>
                  </View>
                  <View style={styles.heroFreePill}>
                    <Text style={styles.heroFreeCount}>{data.best.count}/{data.best.total}</Text>
                    <Text style={styles.heroFreeLabel}>free</Text>
                  </View>
                </LinearGradient>
              </View>
            ) : null}

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
              {(() => {
                const allSlots = data.poll.slots;
                const slotMaxStart = Math.max(0, allSlots.length - SLOT_WINDOW);
                const sWinStart = Math.min(slotWindowStart, slotMaxStart);
                const visibleSlots = allSlots.slice(sWinStart, sWinStart + SLOT_WINDOW);
                const showSlotPager = allSlots.length > SLOT_WINDOW;
                return (
                  <>
                    {showSlotPager && (
                      <View style={[styles.pagerRow, { marginTop: 6 }]}>
                        <TouchableOpacity
                          onPress={() => { Haptics.selectionAsync(); setSlotWindowStart(Math.max(0, sWinStart - SLOT_WINDOW)); }}
                          disabled={sWinStart === 0}
                          style={[styles.pagerBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: sWinStart === 0 ? 0.4 : 1 }]}
                          hitSlop={8}
                        >
                          <Ionicons name="chevron-up" size={18} color={colors.foreground} />
                        </TouchableOpacity>
                        <View style={styles.pagerLabelWrap}>
                          <Text style={[styles.pagerLabel, { color: colors.foreground }]} numberOfLines={1}>
                            {visibleSlots[0]}{visibleSlots.length > 1 ? ` – ${visibleSlots[visibleSlots.length - 1]}` : ""}
                          </Text>
                          <Text style={[styles.pagerSub, { color: colors.textDim }]}>
                            Slots {sWinStart + 1}–{sWinStart + visibleSlots.length} of {allSlots.length}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => { Haptics.selectionAsync(); setSlotWindowStart(Math.min(slotMaxStart, sWinStart + SLOT_WINDOW)); }}
                          disabled={sWinStart >= slotMaxStart}
                          style={[styles.pagerBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: sWinStart >= slotMaxStart ? 0.4 : 1 }]}
                          hitSlop={8}
                        >
                          <Ionicons name="chevron-down" size={18} color={colors.foreground} />
                        </TouchableOpacity>
                      </View>
                    )}
                    {visibleSlots.map((slot) => (
                      <View key={slot} style={styles.gridRow}>
                        <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{slot}</Text>
                        {visibleDays.map((day) => {
                          const cell = `${day}-${slot}`;
                          const c = counts.get(cell) ?? 0;
                          const isLight = total === 0 || c / total < 0.66;
                          const countColor = isLight ? colors.foreground : "#fff";

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
                              onPressIn={() => { longPressFiredRef.current = false; }}
                              onPress={() => { if (longPressFiredRef.current) return; toggleCell(cell); }}
                              onLongPress={() => { longPressFiredRef.current = true; openCellSheet(cell); }}
                              delayLongPress={250}
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

            {!squadId && (
              <TouchableOpacity
                onPress={() => void sharePoll()}
                style={[styles.inviteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                activeOpacity={0.7}
              >
                <View style={[styles.inviteIconWrap, { backgroundColor: colors.primary + "18" }]}>
                  <Ionicons name="person-add-outline" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.inviteCardTitle, { color: colors.foreground }]}>Invite people</Text>
                  <Text style={[styles.inviteCardSub, { color: colors.mutedForeground }]}>
                    Share a link so friends can add their availability
                  </Text>
                </View>
                <Ionicons name="share-outline" size={18} color={colors.primary} />
              </TouchableOpacity>
            )}

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
                {/* NOTE: the old "N still pending" button + modal lived here.
                    It listed the same people as the "Waiting on N" section
                    further down, minus the stale-answer state and the nudge
                    rules — two places to check, one of them wrong. The single
                    follow-up list below is now the only pending surface. */}
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
                    const canNudge = canNudgeMember(m, isCreator);
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
                {/* One follow-up list: never-responded first, then people whose
                    answers predate a date change. Each person appears exactly
                    once, and Nudge only renders where the server accepts it
                    (no response row) instead of 400-ing on stale responders. */}
                {(() => {
                  const followUps = buildFollowUpList(data.members);
                  if (followUps.length === 0) return null;
                  return (
                    <View style={[styles.pendingList, { borderColor: colors.border, backgroundColor: colors.card }]}>
                      <View style={styles.pendingHeader}>
                        <Ionicons name="time-outline" size={14} color={colors.gold} />
                        <Text style={[styles.pendingHeaderText, { color: colors.mutedForeground }]}>
                          Waiting on {followUps.length}
                        </Text>
                      </View>
                      {followUps.map((m) => {
                        const state = memberFollowUpState(m);
                        const nudged = nudgeState.get(m.id) === "sent";
                        const nudging = nudgeState.get(m.id) === "sending";
                        const showNudge = canNudgeMember(m, isCreator);
                        return (
                          <View key={m.id} style={styles.pendingMemberRow}>
                            <View style={[styles.pendingAvatar, { backgroundColor: state === "stale" ? colors.gold + "33" : colors.border + "33", borderColor: state === "stale" ? colors.gold : colors.border }]}>
                              <Text style={[styles.pendingInitial, { color: state === "stale" ? colors.gold : colors.mutedForeground }]}>
                                {m.displayName.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.pendingName, { color: colors.foreground }]}>{m.displayName}</Text>
                              <Text style={[styles.pendingStatus, { color: colors.textDim }]}>
                                {followUpStateLabel(state)}
                              </Text>
                            </View>
                            {showNudge && (
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
                  );
                })()}

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
            {resultKind !== "none" && !dirty && (
              <TouchableOpacity
                onPress={() =>
                  data.bestStretch
                    ? void useThisStretch(data.bestStretch.startDate, data.bestStretch.endDate)
                    : void useThisTime()
                }
                style={[styles.secondaryBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "14" }]}
              >
                <Ionicons name={eventId ? "checkmark-circle-outline" : "calendar-outline"} size={18} color={colors.primary} />
                <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                  {data.bestStretch
                    ? // Say "these dates" rather than "the best dates" when the
                      // winning stretch works for nobody end-to-end.
                      data.bestStretch.partial
                      ? "Lock in these dates anyway"
                      : "Lock in the best dates"
                    : eventId
                      ? `Use ${prettyCell(data.best!.cell)}`
                      : isTrip
                        ? "Lock in the best dates"
                        : "Create event at best time"}
                </Text>
              </TouchableOpacity>
            )}
            {/* Results actions are unavailable until someone has answered —
                say why instead of showing nothing at all. */}
            {resultKind === "none" && !dirty && (data.respondentCount ?? 0) === 0 && (
              <View style={[styles.disabledResultBtn, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Ionicons name="hourglass-outline" size={16} color={colors.mutedForeground} />
                <Text style={[styles.disabledResultText, { color: colors.mutedForeground }]}>
                  {isTrip
                    ? "The best dates appear once someone responds"
                    : "A best time appears once someone responds"}
                </Text>
              </View>
            )}
            {/* Results have exactly ONE primary action. The old bar stacked
                "use the best time", "pick a different time" and "create an
                event outside this poll", which turned the end of a poll into a
                three-way decision. Picking a non-winning slot now happens where
                the times actually are: tap that cell in the grid. */}
            {(() => {
              const s = saveButtonState({ dirty, saving, justSaved });
              return (
                <GradientButton
                  label={s.label === "Save" ? "Save my availability" : s.label}
                  onPress={() => void save()}
                  disabled={s.disabled}
                />
              );
            })()}
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

                    {/* Creator-only: lock in THIS slot. Replaces the old
                        "pick a different time" sheet — choosing a runner-up now
                        happens on the cell itself, where you can already see
                        who is free, instead of in a second ranked list.

                        On a trip poll with a known length the unit of choice is
                        a RUN of days, so this offers "start the trip here" and
                        states up-front how many people that run actually works
                        for — including when the answer is nobody. */}
                    {isCreator && (() => {
                      const day = splitCell(selectedCell).day;
                      const stretch =
                        loadedTripLength && data.memberCells
                          ? tripStretchFor({
                              days: data.poll.days,
                              lengthDays: loadedTripLength,
                              memberCells: data.memberCells,
                              startDate: day,
                            })
                          : null;

                      if (loadedTripLength) {
                        // Too close to the end of the voting window for a full
                        // run — say so rather than offering a truncated trip.
                        if (!canStartTripOn(data.poll.days, loadedTripLength, day)) {
                          return (
                            <Text style={[styles.cellSheetEmpty, { color: colors.mutedForeground, marginTop: 12 }]}>
                              A {loadedTripLength}-day {planNoun(isTrip ? "trip" : "event")} doesn&apos;t
                              fit starting here — pick an earlier date.
                            </Text>
                          );
                        }
                        if (stretch) {
                          return (
                            <TouchableOpacity
                              onPress={() => {
                                closeCellSheet();
                                void useThisStretch(stretch.startDate, stretch.endDate);
                              }}
                              style={[
                                styles.cellSheetToggleBtn,
                                { backgroundColor: "transparent", borderColor: colors.primary, marginTop: 10 },
                              ]}
                            >
                              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.cellSheetToggleBtnText, { color: colors.primary }]}>
                                  {isTrip ? "Start the trip here" : "Start the event here"}
                                </Text>
                                <Text style={[styles.cellSheetStretchNote, { color: colors.mutedForeground }]}>
                                  {prettyDay(stretch.startDate)} – {prettyDay(stretch.endDate)} ·{" "}
                                  {stretch.partial
                                    ? `no one is free all ${stretch.lengthDays} days`
                                    : `${stretch.count} of ${stretch.total} free the whole time`}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        }
                      }

                      return (
                        <TouchableOpacity
                          onPress={() => {
                            const cell = selectedCell;
                            closeCellSheet();
                            if (cell) void useThisTime(cell);
                          }}
                          style={[
                            styles.cellSheetToggleBtn,
                            { backgroundColor: "transparent", borderColor: colors.primary, marginTop: 10 },
                          ]}
                        >
                          <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                          <Text style={[styles.cellSheetToggleBtnText, { color: colors.primary }]}>
                            {eventId ? "Use this time" : "Create event at this time"}
                          </Text>
                        </TouchableOpacity>
                      );
                    })()}
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
        onRequestClose={closeEditRange}
      >
        <View style={styles.pickerOverlay}>
          <View style={[styles.editSheet, { backgroundColor: colors.background, paddingBottom: botPad + 12 }]}>
            <View style={[styles.pickerToolbar, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={closeEditRange} style={styles.pickerBtn}>
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

              {/* Plan length is a different span from the voting window above,
                  so it gets its own control and its own explanation. It is
                  offered on BOTH kinds — a two-day event needs the best run of
                  days just as a trip does. Changing it only re-ranks the days
                  people already marked; no answers are trimmed. */}
              <Text style={[styles.setupLabel, { color: colors.mutedForeground }]}>
                {isTrip ? "How long is the trip?" : "How long is the event?"}
              </Text>
              <View style={styles.chipRow}>
                {!isTrip && (
                  // Events can be a single day, and that is the answer that
                  // keeps them on "one best time". It must be reachable from
                  // the editor, not only at creation.
                  <TouchableOpacity
                    key="edit-plan-1"
                    onPress={() => {
                      Haptics.selectionAsync();
                      setEditTripLength(1);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: editTripLength === 1 ? colors.primary : colors.card,
                        borderColor: editTripLength === 1 ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: editTripLength === 1 ? "#fff" : colors.foreground }]}>
                      1 day
                    </Text>
                  </TouchableOpacity>
                )}
                {tripLengthOptionsFor(editDays).map((n) => {
                  const active = editTripLength === n;
                  return (
                    <TouchableOpacity
                      key={`edit-plan-${n}`}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setEditTripLength(n);
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                        {n} days
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.wizardHint, { color: colors.textDim }]}>
                {editTripLength === null
                  ? // No length was ever chosen (a legacy trip, or a plain
                    // single-day event), so no chip is selected and none is
                    // assumed. Explain what picking one would change instead of
                    // pretending a default is set.
                    `This ${planNoun(isTrip ? "trip" : "event")} doesn't have a length yet, so we're picking the single best day. Choose a length to find the best run of days instead.`
                  : editTripLength <= 1
                    ? "We'll pick the single best day and time. Choose 2+ days to find the best run instead."
                    : `We'll find the best ${editTripLength} days in a row inside this range. Changing this keeps everyone's answers.`}
              </Text>

              {!isTrip && (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6, marginTop: 14 }}>
                    <Text style={[styles.setupLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>Time slots</Text>
                    <Text style={[styles.chipText, { color: colors.mutedForeground }]}>{editSlots.size} selected</Text>
                  </View>
                  <View style={[styles.chipRow, { marginBottom: 8 }]}>
                    {SLOT_PERIODS.map((p) => (
                      <TouchableOpacity
                        key={p.label}
                        onPress={() => { Haptics.selectionAsync(); setEditSlotPeriod(p.label); }}
                        style={[styles.chip, { backgroundColor: editSlotPeriod === p.label ? colors.primary : colors.card, borderColor: editSlotPeriod === p.label ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.chipText, { color: editSlotPeriod === p.label ? "#fff" : colors.foreground }]}>{p.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.chipRow}>
                    {(SLOT_PERIODS.find(p => p.label === editSlotPeriod)?.slots ?? SLOT_PERIODS[3].slots).map((s) => {
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
                </>
              )}

              <View style={[styles.previewCard, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "44" }]}>
                <Ionicons name="time-outline" size={16} color={colors.primary} />
                <Text style={[styles.previewText, { color: colors.foreground }]}>{editRangePreview}</Text>
              </View>

              <Text style={[styles.editRangeNote, { color: colors.mutedForeground }]}>
                Existing responses outside the new range will be trimmed automatically.
              </Text>
            </ScrollView>

            {/* Android keeps its native dialog as a sibling — that's the
                platform-correct presentation and it doesn't deadlock. */}
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

            {/* iOS: an IN-SHEET overlay, never a nested Modal.
                Opening a second Modal while this edit sheet is up freezes iOS —
                the picker never appears and the whole UI stops responding, so
                the host can't even close the sheet. Absolutely positioned
                inside the sheet it presents normally. */}
            {Platform.OS === "ios" && editPickerOpen && (
              <View style={styles.inSheetPickerOverlay}>
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
            )}
          </View>
        </View>
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
  terminalTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  retryBtn: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { fontSize: 14, fontWeight: "700" },
  body: { flex: 1 },
  subtitle: { fontSize: 14, lineHeight: 21, paddingTop: 16, paddingBottom: 4 },
  heroWrap: { marginTop: 16, borderRadius: 20, shadowColor: "#FF6B2C", shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  heroCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 20, paddingVertical: 18, paddingHorizontal: 18 },
  setupHeroCard: { borderRadius: 20, paddingVertical: 22, paddingHorizontal: 20, gap: 10 },
  setupHeroTitle: { fontSize: 22, fontWeight: "900", color: "#fff", letterSpacing: -0.4, lineHeight: 27 },
  setupHeroSub: { fontSize: 14, lineHeight: 20, color: "rgba(255,255,255,0.92)", fontWeight: "500" },
  heroIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  heroLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 1, color: "rgba(255,255,255,0.9)" },
  heroValue: { fontSize: 22, fontWeight: "900", color: "#fff", marginTop: 3, letterSpacing: -0.3 },
  heroSubLabel: { fontSize: 12, fontWeight: "600", color: "rgba(255,255,255,0.92)", marginTop: 4, lineHeight: 16 },
  cellSheetStretchNote: { fontSize: 12, fontWeight: "600", marginTop: 2 },
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
  respondedDot: { position: "absolute", bottom: -2, right: -2, width: 15, height: 15, borderRadius: 7.5, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#0F0F14" },
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
  wizardSteps: { flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 4 },
  wizardStepItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  wizardStepDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  wizardStepNum: { fontSize: 11, fontWeight: "800" },
  wizardStepLabel: { fontSize: 12, fontWeight: "700" },
  wizardStepBar: { width: 22, height: 2, borderRadius: 1, marginHorizontal: 8 },
  wizardHint: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  kindCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 10,
  },
  kindCardIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  kindCardTitle: { fontSize: 16, fontWeight: "800" },
  kindCardBlurb: { fontSize: 12, fontWeight: "600", marginTop: 2, lineHeight: 17 },
  wizardNavRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  wizardBackBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 15 },
  wizardBackText: { fontSize: 15, fontWeight: "800" },
  selectedSlotChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 22, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 9 },
  draftBanner: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, padding: 12, marginTop: 14 },
  draftBannerText: { flex: 1, fontSize: 13, fontWeight: "600" },
  draftBannerAction: { fontSize: 13, fontWeight: "800" },
  // iOS in-sheet picker backdrop. Fills the edit sheet rather than presenting a
  // nested Modal (which deadlocks iOS).
  inSheetPickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  disabledResultBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, borderWidth: 1.5, paddingVertical: 15 },
  disabledResultText: { fontSize: 14, fontWeight: "700" },
  followUpRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  pickerOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  pickerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 1 },
  pickerBtn: { padding: 8 },
  pickerBtnText: { fontSize: 15 },
  pickerTitle: { fontSize: 16, fontWeight: "800" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerActionBtn: { padding: 8 },
  inviteCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 13, marginTop: 14 },
  inviteIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  inviteCardTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  inviteCardSub: { fontSize: 12, lineHeight: 16 },
  skipPollBtn: { alignItems: "center", paddingVertical: 2 },
  skipPollBtnText: { fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
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
