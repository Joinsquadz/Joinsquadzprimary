import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useAuth } from "@/context/AppContext";
import {
  formatEventTimeIn,
  formatInstantIn,
  formatRangeIn,
  formatTripRangeIn,
  parseIso,
  runtimeTimezone,
  zoneAbbreviation,
  type TimeDisplayEvent,
} from "@/lib/timezoneFormat";
import {
  resolveOfflineTimezone,
  resolveSyncedTimezone,
  shouldPersistDetected,
  type TimezoneMode,
} from "@/lib/timezonePreference";

/**
 * Pure formatting lives in lib/timezoneFormat so it can be unit-tested without
 * the native runtime; this context only owns the viewer's selected zone.
 */
export {
  runtimeTimezone,
  zoneAbbreviation,
  zoneLabel,
  type TimeDisplayEvent,
} from "@/lib/timezoneFormat";

type TimezoneContextValue = {
  timezone: string;
  mode: TimezoneMode;
  setManualTimezone: (timezone: string) => Promise<boolean>;
  useAutomaticTimezone: () => Promise<boolean>;
  /** "Sat, Jun 7 · 8:00 PM PDT" in the viewer's zone; falls back to event.date. */
  formatEventTime: (event: TimeDisplayEvent) => string;
  /** Same shape as formatEventTime, for a bare ISO instant. Empty when unusable. */
  formatInstant: (iso: string | null | undefined) => string;
  /** "Jul 18 – 22, 2026" trip range rendered in the viewer's zone. */
  formatDateRange: (startIso: string | null | undefined, endIso: string | null | undefined) => string;
  /** Trip range that respects all-day trips (keeps the authored dates). */
  formatTripDateRange: (trip: TimeDisplayEvent) => string;
  /** Daylight-aware abbreviation for the viewer's zone right now (e.g. "PDT"). */
  abbreviation: string;
};

const CACHE_KEY = "@squadz/timezone";

async function readCachedTimezone(): Promise<{ timezone?: string; mode?: TimezoneMode } | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    return cached ? JSON.parse(cached) as { timezone?: string; mode?: TimezoneMode } : null;
  } catch {
    // Corrupt cache entry must not take the whole provider down.
    return null;
  }
}
const TimezoneContext = createContext<TimezoneContextValue | null>(null);

export function TimezoneProvider({ children }: PropsWithChildren) {
  const { authToken, isLoggedIn } = useAuth();
  const [timezone, setTimezone] = useState(runtimeTimezone());
  const [mode, setMode] = useState<TimezoneMode>("automatic");

  const persist = useCallback(async (nextTimezone: string, nextMode: TimezoneMode): Promise<boolean> => {
    if (!authToken) return false;
    const response = await fetch(`${API_BASE}/api/user/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...buildAuthHeaders(authToken) },
      body: JSON.stringify({ timezone: nextTimezone, timezoneMode: nextMode }),
    });
    if (!response.ok) return false;
    setTimezone(nextTimezone);
    setMode(nextMode);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ timezone: nextTimezone, mode: nextMode }));
    return true;
  }, [authToken]);

  const sync = useCallback(async () => {
    const detected = runtimeTimezone();

    // Always hydrate from cache FIRST, logged in or not. A manual choice must
    // survive a cold start with no network: if we skipped straight to the
    // network read, a failure would leave the user on the detected device zone
    // and silently undo their selection.
    const cached = await readCachedTimezone();
    if (cached?.timezone) setTimezone(cached.timezone);
    if (cached?.mode) setMode(cached.mode);
    if (!authToken) return;

    try {
      const response = await fetch(`${API_BASE}/api/user/preferences`, { headers: buildAuthHeaders(authToken) });
      if (!response.ok) return;
      const prefs = await response.json() as { timezone?: string | null; timezoneMode?: TimezoneMode };
      const { timezone: nextTimezone, mode: nextMode } = resolveSyncedTimezone(prefs, detected);
      setTimezone(nextTimezone);
      setMode(nextMode);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ timezone: nextTimezone, mode: nextMode }));
      if (shouldPersistDetected(prefs, detected)) await persist(detected, "automatic");
    } catch {
      // Offline / preferences unreachable. A manual selection is never
      // overwritten; without one, automatic mode tracks the device.
      const offline = resolveOfflineTimezone(cached, detected);
      setTimezone(offline.timezone);
      setMode(offline.mode);
    }
  }, [authToken, persist]);

  useEffect(() => { void sync(); }, [sync, isLoggedIn]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") void sync(); });
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const timer = window.setInterval(() => { if (mode === "automatic") void sync(); }, 60_000);
      return () => { subscription.remove(); window.clearInterval(timer); };
    }
    return () => subscription.remove();
  }, [mode, sync]);

  const value = useMemo<TimezoneContextValue>(() => ({
    timezone,
    mode,
    setManualTimezone: (next) => persist(next, "manual"),
    useAutomaticTimezone: () => persist(runtimeTimezone(), "automatic"),
    formatEventTime: (event) => formatEventTimeIn(event, timezone),
    formatInstant: (iso) => {
      const date = parseIso(iso);
      return date ? formatInstantIn(date, timezone) : "";
    },
    formatDateRange: (startIso, endIso) => formatRangeIn(startIso, endIso, timezone),
    formatTripDateRange: (trip) => formatTripRangeIn(trip, timezone),
    abbreviation: zoneAbbreviation(new Date(), timezone),
  }), [mode, persist, timezone]);

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
}

export function useTimezone(): TimezoneContextValue {
  const value = useContext(TimezoneContext);
  if (!value) throw new Error("useTimezone must be used inside TimezoneProvider");
  return value;
}