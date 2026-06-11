import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useData } from "@/context/AppContext";

export type TipLayout = { x: number; y: number; width: number; height: number };

export type SquadAnchorKey = "events" | "poll" | "chat";

export type TipDef = {
  /** Where the tip lives: on the squad detail screen or anchored to the Feed tab. */
  place: "squad" | "feedTab";
  /** Which squad-screen element to anchor to (only for place === "squad"). */
  target?: SquadAnchorKey;
  headline: string;
  body: string;
};

// Sequential first-run tour. Tips 1-4 live on the squad detail screen, tips
// 5-6 on the Feed tab. Tip 4 (cost split) anchors to the Events section because
// cost splitting lives inside each event, not on the squad screen.
export const TIPS: TipDef[] = [
  {
    place: "squad",
    target: "events",
    headline: "Create your first event",
    body: "Pick a date, add a location, and invite your crew.",
  },
  {
    place: "squad",
    target: "poll",
    headline: "Find a time everyone's free",
    body: "Drop a poll and let your squad respond.",
  },
  {
    place: "squad",
    target: "chat",
    headline: "Talk it out",
    body: "Every squad has its own group chat — no more lost plans in a group text.",
  },
  {
    place: "squad",
    target: "events",
    headline: "Split costs without the awkwardness",
    body: "Open any event to log expenses and track who owes what.",
  },
  {
    place: "feedTab",
    headline: "Catch Moments here too",
    body: "Squad Moments and Friends Moments both live in your feed ring row at the top.",
  },
  {
    place: "feedTab",
    headline: "See what your crew is up to",
    body: "Post a Vibe to let your friends know you're free.",
  },
];

type TipsContextValue = {
  activeIndex: number | null;
  tips: TipDef[];
  anchors: Record<SquadAnchorKey, TipLayout | null>;
  /** Mark that the tour should begin on the first squad screen the user lands on. */
  armTour: () => void;
  /** Called by the squad screen once it has mounted with a loaded squad. */
  maybeStartTour: () => void;
  next: () => void;
  dismiss: () => void;
  setSquadAnchor: (key: SquadAnchorKey, layout: TipLayout | null) => void;
  clearSquadAnchors: () => void;
};

const EMPTY_ANCHORS: Record<SquadAnchorKey, TipLayout | null> = {
  events: null,
  poll: null,
  chat: null,
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
});

export function TipsProvider({ children }: { children: React.ReactNode }) {
  const { currentUser } = useData();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [anchors, setAnchors] = useState<Record<SquadAnchorKey, TipLayout | null>>(EMPTY_ANCHORS);

  const armedRef = useRef(false);
  const startedRef = useRef(false);
  const activeIndexRef = useRef<number | null>(null);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const [seen, setSeen] = useState(false);
  const [seenLoaded, setSeenLoaded] = useState(false);

  const userId = currentUser?.id;
  const storageKey = userId && userId !== "me" ? `tips_seen_${userId}` : null;

  // Load the per-user "seen" flag whenever the signed-in user changes.
  useEffect(() => {
    let cancelled = false;
    if (!storageKey) {
      setSeen(false);
      setSeenLoaded(false);
      return;
    }
    setSeenLoaded(false);
    AsyncStorage.getItem(storageKey)
      .then((v) => {
        if (cancelled) return;
        setSeen(v === "1");
        setSeenLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setSeenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const persistSeen = useCallback(() => {
    setSeen(true);
    if (storageKey) AsyncStorage.setItem(storageKey, "1").catch(() => {});
  }, [storageKey]);

  const armTour = useCallback(() => {
    armedRef.current = true;
    startedRef.current = false;
  }, []);

  const maybeStartTour = useCallback(() => {
    if (!armedRef.current || startedRef.current) return;
    if (!seenLoaded || seen) return;
    if (activeIndexRef.current !== null) return;
    startedRef.current = true;
    setActiveIndex(0);
  }, [seenLoaded, seen]);

  const finish = useCallback(() => {
    armedRef.current = false;
    setActiveIndex(null);
    persistSeen();
  }, [persistSeen]);

  const next = useCallback(() => {
    const prev = activeIndexRef.current;
    if (prev === null) return;
    const nextIdx = prev + 1;
    if (nextIdx >= TIPS.length) {
      finish();
      return;
    }
    // Crossing from the squad screen to the Feed-tab tips: leave the stacked
    // squad screen and land on the Feed tab so tips 5-6 have their context.
    if (TIPS[prev].place === "squad" && TIPS[nextIdx].place === "feedTab") {
      router.replace("/(tabs)/feed" as never);
    }
    setActiveIndex(nextIdx);
  }, [finish]);

  const dismiss = useCallback(() => {
    finish();
  }, [finish]);

  const setSquadAnchor = useCallback((key: SquadAnchorKey, layout: TipLayout | null) => {
    setAnchors((prevAnchors) => ({ ...prevAnchors, [key]: layout }));
  }, []);

  const clearSquadAnchors = useCallback(() => {
    setAnchors(EMPTY_ANCHORS);
  }, []);

  const value: TipsContextValue = {
    activeIndex,
    tips: TIPS,
    anchors,
    armTour,
    maybeStartTour,
    next,
    dismiss,
    setSquadAnchor,
    clearSquadAnchors,
  };

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
}

export const useTips = () => useContext(TipsContext);
