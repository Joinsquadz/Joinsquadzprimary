import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useData } from "@/context/AppContext";
import { track } from "@/lib/analytics";

export type TipLayout = { x: number; y: number; width: number; height: number };

export type SquadAnchorKey = "events" | "plans" | "poll" | "chat" | "vault";
export type CoachTourStep =
  | "event"
  | "trip"
  | "availability"
  | "chat"
  | "moments"
  | "vibe_feed"
  | "vault";

export type TipDef = {
  /** Where the tip lives: on the squad detail screen or anchored to the Feed tab. */
  place: "squad" | "feedTab";
  /** Which squad-screen element to anchor to (only for place === "squad"). */
  target?: SquadAnchorKey;
  step: CoachTourStep;
  headline: string;
  body: string;
};

// Sequential first-run tour shown on the first squad the user lands on. Tips
// 1-3 live on the squad detail screen, tips 4-5 on the Feed tab. Cost splitting
// is NOT part of this tour — it surfaces contextually on the event screen (see
// the standalone "event cost" tip below) because that's where splitting lives.
export const TIPS: TipDef[] = [
  {
    place: "squad",
    target: "events",
    step: "event",
    headline: "Create your first event",
    body: "Pick a date, add a location, and invite your crew.",
  },
  {
    place: "squad",
    target: "plans",
    step: "trip",
    headline: "Plan your first trip",
    body: "Build a shared itinerary, packing list, and plan with your squad.",
  },
  {
    place: "squad",
    target: "poll",
    step: "availability",
    headline: "Find a time everyone's free",
    body: "Drop a poll and let your squad respond.",
  },
  {
    place: "squad",
    target: "chat",
    step: "chat",
    headline: "Talk it out",
    body: "Every squad has its own group chat — no more lost plans in a group text.",
  },
  {
    place: "feedTab",
    step: "moments",
    headline: "Catch Moments here too",
    body: "Squad Moments and Friends Moments both live in your feed ring row at the top.",
  },
  {
    place: "feedTab",
    step: "vibe_feed",
    headline: "See what your crew is up to",
    body: "Post a Vibe to let your friends know you're free.",
  },
  {
    place: "squad",
    target: "vault",
    step: "vault",
    headline: "Keep memories in your Squad Vault",
    body: "Save your squad's photos and videos together in one private place.",
  },
];

// Standalone, contextual coach mark for cost splitting. Unlike the sequential
// tour, this fires in real time the first time a user opens an event detail
// screen, anchored to that screen's "Costs" tab — so the tip appears on the
// exact surface where splitting actually happens.
export const EVENT_COST_TIP = {
  headline: "Split costs without the awkwardness",
  body: "Open the Costs tab to log expenses and track who owes what — no spreadsheets, no chasing.",
};

type TipsContextValue = {
  activeIndex: number | null;
  tips: TipDef[];
  anchors: Record<SquadAnchorKey, TipLayout | null>;
  /** Mark that the tour should begin on the first squad screen the user lands on. */
  armTour: () => void;
  /** Called by the squad screen once it has mounted with a loaded squad. */
  maybeStartTour: (squadId: string) => void;
  next: () => void;
  dismiss: () => void;
  setSquadAnchor: (key: SquadAnchorKey, layout: TipLayout | null) => void;
  clearSquadAnchors: () => void;
  // Standalone, contextual cost-split tip shown on the event detail screen.
  eventCostActive: boolean;
  eventCostAnchor: TipLayout | null;
  /**
   * True only while every precondition for showing the cost tip holds (seen flag
   * loaded + unseen, no sequential tour in flight, not already active). The event
   * screen depends on this so it re-attempts the moment the gate opens — e.g. the
   * tour finishes, or the fail-safe releases a stuck active flag.
   */
  canShowEventCostTip: boolean;
  /** Called by the event screen on first open; shows the cost tip if unseen. */
  maybeShowEventCostTip: () => void;
  setEventCostAnchor: (layout: TipLayout | null) => void;
  dismissEventCostTip: () => void;
};

const EMPTY_ANCHORS: Record<SquadAnchorKey, TipLayout | null> = {
  events: null,
  plans: null,
  poll: null,
  chat: null,
  vault: null,
};

const TipsContext = createContext<TipsContextValue>({
  activeIndex: null,
  tips: TIPS,
  anchors: EMPTY_ANCHORS,
  armTour: () => {},
  maybeStartTour: () => {},
  next: () => {},
  dismiss: () => {},
  setSquadAnchor: () => {},
  clearSquadAnchors: () => {},
  eventCostActive: false,
  eventCostAnchor: null,
  canShowEventCostTip: false,
  maybeShowEventCostTip: () => {},
  setEventCostAnchor: () => {},
  dismissEventCostTip: () => {},
});

export function TipsProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useData();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [anchors, setAnchors] = useState<Record<SquadAnchorKey, TipLayout | null>>(EMPTY_ANCHORS);

  const armedRef = useRef(false);
  const startedRef = useRef(false);
  const activeIndexRef = useRef<number | null>(null);
  const activeSquadIdRef = useRef<string | null>(null);
  const trackedStepsRef = useRef(new Set<CoachTourStep>());
  const tourActionLockedRef = useRef(false);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
    tourActionLockedRef.current = false;
  }, [activeIndex]);

  const [seen, setSeen] = useState(false);
  const [seenLoaded, setSeenLoaded] = useState(false);

  // Standalone cost-split tip (event screen) — independent state + seen flag.
  const [eventCostActive, setEventCostActive] = useState(false);
  const [eventCostAnchor, setEventCostAnchorState] = useState<TipLayout | null>(null);
  const [costSeen, setCostSeen] = useState(false);
  const [costSeenLoaded, setCostSeenLoaded] = useState(false);
  const eventCostActiveRef = useRef(false);
  const eventCostAnchorRef = useRef<TipLayout | null>(null);
  const eventCostViewTrackedRef = useRef(false);
  const eventCostDismissTrackedRef = useRef(false);
  useEffect(() => {
    eventCostActiveRef.current = eventCostActive;
  }, [eventCostActive]);
  useEffect(() => {
    eventCostAnchorRef.current = eventCostAnchor;
  }, [eventCostAnchor]);

  // Fail-safe: if the tip turns active but no anchor is acquired shortly after
  // (layout race, offscreen chip, the user navigates away before measuring),
  // release `eventCostActive` so it never gets stuck in an invisible state that
  // blocks every future attempt. We do NOT mark it seen — it can re-fire the
  // next time the user opens an event.
  useEffect(() => {
    if (!eventCostActive || eventCostAnchor) return;
    const t = setTimeout(() => {
      if (eventCostActiveRef.current && !eventCostAnchorRef.current) {
        setEventCostActive(false);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [eventCostActive, eventCostAnchor]);

  const userId = currentUser?.id;
  const storageKey = userId && userId !== "me" ? `tips_seen_${userId}` : null;
  const costStorageKey = userId && userId !== "me" ? `tip_eventcost_seen_${userId}` : null;

  // Load the per-user "seen" flags whenever the signed-in user changes. Both
  // flags are user-id-suffixed and kept OUT of ALL_APP_STORAGE_KEYS so they
  // survive logout/login ("show once per user, ever").
  useEffect(() => {
    let cancelled = false;
    if (!storageKey) {
      setSeen(false);
      setSeenLoaded(false);
      setCostSeen(false);
      setCostSeenLoaded(false);
      return;
    }
    setSeenLoaded(false);
    setCostSeenLoaded(false);
    AsyncStorage.getItem(storageKey)
      .then((v) => {
        if (cancelled) return;
        setSeen(v === "1");
        setSeenLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSeenLoaded(true);
      });
    AsyncStorage.getItem(costStorageKey as string)
      .then((v) => {
        if (cancelled) return;
        setCostSeen(v === "1");
        setCostSeenLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setCostSeenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, costStorageKey]);

  useEffect(() => {
    trackedStepsRef.current.clear();
    eventCostViewTrackedRef.current = false;
    eventCostDismissTrackedRef.current = false;
  }, [storageKey]);

  const persistSeen = useCallback(() => {
    setSeen(true);
    if (storageKey) AsyncStorage.setItem(storageKey, "1").catch(() => {});
  }, [storageKey]);

  const armTour = useCallback(() => {
    armedRef.current = true;
    startedRef.current = false;
  }, []);

  const maybeStartTour = useCallback((squadId: string) => {
    if (!armedRef.current || startedRef.current) return;
    if (!seenLoaded || seen) return;
    if (activeIndexRef.current !== null) return;
    startedRef.current = true;
    activeSquadIdRef.current = squadId;
    setActiveIndex(0);
  }, [seenLoaded, seen]);

  const finish = useCallback(() => {
    armedRef.current = false;
    setActiveIndex(null);
    persistSeen();
    activeSquadIdRef.current = null;
  }, [persistSeen]);

  const next = useCallback(() => {
    if (tourActionLockedRef.current) return;
    const prev = activeIndexRef.current;
    if (prev === null) return;
    tourActionLockedRef.current = true;
    const nextIdx = prev + 1;
    if (nextIdx >= TIPS.length) {
      track("coach_tour_completed");
      finish();
      return;
    }
    // Crossing from the squad screen to the Feed-tab tips: leave the stacked
    // squad screen and land on the Feed tab so the Feed tips have their context.
    if (TIPS[prev].place === "squad" && TIPS[nextIdx].place === "feedTab") {
      router.replace("/(tabs)/feed" as never);
    }
    if (TIPS[prev].place === "feedTab" && TIPS[nextIdx].place === "squad") {
      const squadId = activeSquadIdRef.current;
      if (squadId) {
        router.replace({ pathname: "/squad/[id]", params: { id: squadId } } as never);
      }
    }
    setActiveIndex(nextIdx);
  }, [finish]);

  const dismiss = useCallback(() => {
    if (tourActionLockedRef.current) return;
    tourActionLockedRef.current = true;
    const index = activeIndexRef.current;
    const step = index === null ? null : TIPS[index]?.step;
    if (step) track("coach_tour_dismissed", { step });
    finish();
  }, [finish]);

  const setSquadAnchor = useCallback((key: SquadAnchorKey, layout: TipLayout | null) => {
    setAnchors((prevAnchors) => ({ ...prevAnchors, [key]: layout }));
  }, []);

  const clearSquadAnchors = useCallback(() => {
    setAnchors(EMPTY_ANCHORS);
  }, []);

  // First time the user opens an event, surface the cost-split tip in context.
  // Skip if the sequential tour is mid-flight so two coach marks never overlap.
  const maybeShowEventCostTip = useCallback(() => {
    if (eventCostActiveRef.current) return;
    if (!costSeenLoaded || costSeen) return;
    if (activeIndexRef.current !== null) return;
    eventCostViewTrackedRef.current = false;
    eventCostDismissTrackedRef.current = false;
    setEventCostActive(true);
  }, [costSeenLoaded, costSeen]);

  const setEventCostAnchor = useCallback((layout: TipLayout | null) => {
    setEventCostAnchorState(layout);
    if (
      layout &&
      eventCostActiveRef.current &&
      !eventCostViewTrackedRef.current
    ) {
      eventCostViewTrackedRef.current = true;
      track("event_cost_tip_viewed");
    }
  }, []);

  const dismissEventCostTip = useCallback(() => {
    if (eventCostActiveRef.current && !eventCostDismissTrackedRef.current) {
      eventCostDismissTrackedRef.current = true;
      track("event_cost_tip_dismissed");
    }
    setEventCostActive(false);
    setEventCostAnchorState(null);
    setCostSeen(true);
    if (costStorageKey) AsyncStorage.setItem(costStorageKey, "1").catch(() => {});
  }, [costStorageKey]);

  // Single gate the event screen watches so it re-attempts the moment showing
  // becomes allowed (tour ends, fail-safe releases a stuck flag, seen flag loads).
  const canShowEventCostTip =
    costSeenLoaded && !costSeen && activeIndex === null && !eventCostActive;

  useEffect(() => {
    if (activeIndex === null) return;
    const step = TIPS[activeIndex]?.step;
    if (!step || trackedStepsRef.current.has(step)) return;
    trackedStepsRef.current.add(step);
    track("coach_tour_step_viewed", { step });
  }, [activeIndex]);

  const value: TipsContextValue = useMemo(
    () => ({
      activeIndex,
      tips: TIPS,
      anchors,
      armTour,
      maybeStartTour,
      next,
      dismiss,
      setSquadAnchor,
      clearSquadAnchors,
      eventCostActive,
      eventCostAnchor,
      canShowEventCostTip,
      maybeShowEventCostTip,
      setEventCostAnchor,
      dismissEventCostTip,
    }),
    [
      activeIndex,
      anchors,
      armTour,
      maybeStartTour,
      next,
      dismiss,
      setSquadAnchor,
      clearSquadAnchors,
      eventCostActive,
      eventCostAnchor,
      canShowEventCostTip,
      maybeShowEventCostTip,
      setEventCostAnchor,
      dismissEventCostTip,
    ],
  );

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
}

export const useTips = () => useContext(TipsContext);
