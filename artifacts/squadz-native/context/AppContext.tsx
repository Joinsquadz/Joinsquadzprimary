import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useToast } from "@/context/ToastContext";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/lib/api";
// Expo's streaming-capable fetch. React Native's built-in fetch does NOT
// populate `response.body` (no ReadableStream), so the SSE reader below could
// never start and the global live-status banner would be stuck reconnecting on
// a device. expo/fetch returns a real streaming body on both native and web.
import { fetch as streamFetch } from "expo/fetch";
import { clearProfileCache } from "@/hooks/useUserProfiles";
import { ME } from "@/data/mock";
import type { Event, Squad, RsvpStatus, Cost, CostShare, ItineraryStop } from "@/types";
import { track, identify, reset as analyticsReset } from "@/lib/analytics";

const AUTH_TOKEN_KEY = "@squadz/authToken";
const REFRESH_TOKEN_KEY = "@squadz/refreshToken";
// Set at register time (token persisted, but onboarding not yet finished) and
// removed once onboarding's login() completes. Lets a relaunch distinguish a
// registered-but-abandoned-onboarding session from a fully onboarded one, so we
// can resume onboarding instead of dropping the user into the app or login.
const ONBOARDING_PENDING_KEY = "@squadz/onboardingPending";

/**
 * Thrown by addSquad when the server rejects a create because the free user is
 * at the 2-squad limit. Callers can catch this to prompt an upgrade instead of
 * falling back to an optimistic local squad.
 */
export class SquadLimitError extends Error {
  constructor() {
    super("SQUAD_LIMIT");
    this.name = "SquadLimitError";
  }
}

// All app-level AsyncStorage keys. Add new keys here so they are
// automatically cleared on logout, preventing data leaking between accounts.
const ALL_APP_STORAGE_KEYS: string[] = [
  AUTH_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  ONBOARDING_PENDING_KEY,
];

type ApiUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  friendCode: string | null;
};

export type FoundUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  friendCode: string | null;
};

const USER_COLORS = [
  "#FF5C3A", "#A855F7", "#2ECC8A", "#FFB547", "#4A9EFF",
  "#E91E8C", "#00BCD4", "#FF9800", "#8BC34A", "#9C27B0",
];

function colorFromId(id: string): string {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

// Turn an email local-part into a friendly display name, e.g.
// "jordan.park@x.com" -> "Jordan Park", "jdoe@x.com" -> "Jdoe".
function nameFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim();
  const words = local.replace(/[._\-+]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function getInitials(u: ApiUser): string {
  if (u.firstName && u.lastName) return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase();
  if (u.firstName) return u.firstName.slice(0, 2).toUpperCase();
  const fromEmail = u.email ? nameFromEmail(u.email) : "";
  if (fromEmail) {
    const parts = fromEmail.split(" ");
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : fromEmail.slice(0, 2)).toUpperCase();
  }
  return "U?";
}

function getUserName(u: ApiUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.firstName) return u.firstName;
  const fromEmail = u.email ? nameFromEmail(u.email) : "";
  return fromEmail || "You";
}

export type PaymentHandles = { venmo: string | null; cashapp: string | null; zelle: string | null };

export type InviteCtx = {
  code: string;
  title: string;
  emoji: string;
  host: string;
  eventId: string;
};

export type NewEventInput = {
  title: string;
  emoji: string;
  date: string;
  /** Machine-readable event start (ISO string) when a concrete time is chosen. */
  eventAt?: string;
  location: string;
  description?: string;
  squadId: string | null;
  isPublic?: boolean;
  /** "trip" creates a multi-day trip; defaults to a one-off event. */
  type?: "event" | "trip";
  /** Trip date range (ISO). startAt also seeds eventAt server-side. */
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  coverStyle?: string;
  /** Optional preloaded itinerary stops (template flow). */
  itinerary?: ItineraryStop[];
  /** Friend user ids to invite directly at creation time. */
  invitedUserIds?: string[];
};

export type ConflictSnapshot = {
  eventId: string;
  title: string;
  date: string;
  location: string;
  description: string;
  tasks: Event["tasks"];
};

type AuthResult = { ok: boolean; error?: string };

type AppContextType = {
  isLoggedIn: boolean;
  /** True while the startup AsyncStorage check is still running. AuthGuard must
   *  not redirect until this is false — otherwise the login screen flashes
   *  briefly on every cold start even for users who are already logged in. */
  isAuthRestoring: boolean;
  pendingOnboarding: boolean;
  currentUser: typeof ME;
  inviteCtx: InviteCtx | null;
  authToken: string | null;
  emailVerified: boolean;
  phone: string | null;
  login: (token?: string) => void;
  registerWithEmail: (input: {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }) => Promise<AuthResult>;
  loginWithEmail: (email: string, password: string) => Promise<AuthResult>;
  forgotPassword: (email: string) => Promise<AuthResult>;
  resendVerification: () => Promise<AuthResult>;
  logout: () => void;
  deleteAccount: () => Promise<AuthResult>;
  refreshUser: () => Promise<void>;
  setInviteCtx: (ctx: InviteCtx | null) => void;

  eventsLoading: boolean;
  squadsLoading: boolean;

  events: Event[];
  getEvent: (id: string) => Event | undefined;
  setRsvp: (eventId: string, status: RsvpStatus) => void;
  addEvent: (input: NewEventInput) => Promise<string>;
  updateEvent: (
    eventId: string,
    patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget" | "isPublic" | "startAt" | "endAt" | "eventAt" | "allDay" | "coverStyle" | "squadId">>,
    explicitVersion?: number,
  ) => void;
  addEventCoAdmin: (eventId: string, userId: string) => Promise<{ error?: string }>;
  removeEventCoAdmin: (eventId: string, userId: string) => Promise<{ error?: string }>;
  addSquadCoAdmin: (squadId: string, userId: string) => Promise<{ error?: string }>;
  removeSquadCoAdmin: (squadId: string, userId: string) => Promise<{ error?: string }>;
  joinEvent: (inviteCode: string) => Promise<{ error?: string }>;
  inviteToEvent: (eventId: string, userIds: string[]) => Promise<{ error?: string }>;
  uninviteFromEvent: (eventId: string, userId: string) => Promise<{ error?: string }>;
  cancelEvent: (eventId: string) => void;
  toggleTask: (eventId: string, taskId: string) => Promise<void>;
  claimTask: (eventId: string, taskId: string) => Promise<void>;
  addTask: (eventId: string, title: string, category?: string) => Promise<{ error?: string }>;
  addCost: (eventId: string, input: { description: string; amount: number; shares: CostShare[] }, explicitVersion?: number) => Promise<{ error?: string }>;
  markSharePaid: (eventId: string, costId: string, paid: boolean, explicitVersion?: number) => void;
  confirmShare: (eventId: string, costId: string, debtorId: string, confirmed: boolean, explicitVersion?: number) => void;
  ownPaymentHandles: PaymentHandles;
  updateOwnPaymentHandles: (patch: Partial<PaymentHandles>) => void;
  fetchPaymentHandles: (
    eventId: string,
  ) => Promise<Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>>;
  addPoll: (eventId: string, question: string, options: string[]) => Promise<{ error?: string }>;
  votePoll: (eventId: string, pollId: string, optionId: string) => void;
  sendMessage: (eventId: string, text: string) => Promise<{ error?: string }>;
  refreshEvents: () => Promise<void>;
  refreshSquads: () => Promise<void>;
  conflictEventId: string | null;
  conflictSnapshot: ConflictSnapshot | null;
  clearConflictEvent: () => void;
  conflictSquadId: string | null;
  clearConflictSquad: () => void;

  squads: Squad[];
  getSquad: (id: string) => Squad | undefined;
  addSquad: (input: { name: string; description?: string; emoji: string; color: string; isPublic?: boolean }) => Promise<string>;
  updateSquad: (id: string, patch: Partial<Pick<Squad, "name" | "description" | "emoji" | "color" | "isPublic" | "membersCanInvite">>) => void;
  regenerateInviteCode: (squadId: string) => Promise<{ error?: string; inviteCode?: string }>;
  leaveSquad: (id: string) => void;
  joinSquad: (squadId: string) => Promise<{ error?: string }>;
  joinSquadByCode: (code: string) => Promise<{ error?: string; revoked?: boolean; limit?: boolean; squad?: Squad; alreadyMember?: boolean }>;
  addMemberByFriendCode: (squadId: string, friendCode: string) => Promise<{ error?: string; user?: FoundUser }>;
  removeMember: (squadId: string, userId: string) => Promise<{ error?: string }>;

  friends: string[];
  friendCode: string;
  addFriend: (userId: string) => void;
  removeFriend: (userId: string) => void;
  outstandingBalancesCount: number;
  squadStreamStatus: "connected" | "reconnecting" | "error";
  retrySquadStream: () => void;
};

const noop = () => {};
const asyncNoop = async () => "";

const INITIAL_FRIENDS: string[] = [];

const AppContext = createContext<AppContextType>({
  isLoggedIn: false,
  isAuthRestoring: true,
  pendingOnboarding: false,
  currentUser: ME,
  inviteCtx: null,
  authToken: null,
  emailVerified: false,
  phone: null,
  login: noop,
  registerWithEmail: async () => ({ ok: false }),
  loginWithEmail: async () => ({ ok: false }),
  forgotPassword: async () => ({ ok: false }),
  resendVerification: async () => ({ ok: false }),
  logout: noop,
  deleteAccount: async () => ({ ok: false }),
  refreshUser: async () => {},
  setInviteCtx: noop,
  eventsLoading: true,
  squadsLoading: true,
  events: [],
  getEvent: () => undefined,
  setRsvp: noop,
  addEvent: asyncNoop,
  updateEvent: noop,
  addEventCoAdmin: async () => ({}),
  removeEventCoAdmin: async () => ({}),
  addSquadCoAdmin: async () => ({}),
  removeSquadCoAdmin: async () => ({}),
  joinEvent: async () => ({}),
  inviteToEvent: async () => ({}),
  uninviteFromEvent: async () => ({}),
  cancelEvent: noop,
  toggleTask: async () => {},
  claimTask: async () => {},
  addTask: async () => ({}),
  addCost: async () => ({}),
  markSharePaid: noop,
  confirmShare: noop,
  ownPaymentHandles: { venmo: null, cashapp: null, zelle: null },
  updateOwnPaymentHandles: noop,
  fetchPaymentHandles: async () => ({}),
  addPoll: async () => ({}),
  votePoll: noop,
  sendMessage: async () => ({}),
  refreshEvents: async () => {},
  refreshSquads: async () => {},
  conflictEventId: null,
  conflictSnapshot: null,
  clearConflictEvent: noop,
  conflictSquadId: null,
  clearConflictSquad: noop,
  squads: [],
  getSquad: () => undefined,
  addSquad: asyncNoop,
  updateSquad: noop,
  regenerateInviteCode: async () => ({}),
  leaveSquad: noop,
  joinSquad: async () => ({}),
  joinSquadByCode: async () => ({}),
  addMemberByFriendCode: async () => ({}),
  removeMember: async () => ({}),
  friends: INITIAL_FRIENDS,
  friendCode: "",
  addFriend: noop,
  removeFriend: noop,
  outstandingBalancesCount: 0,
  squadStreamStatus: "reconnecting",
  retrySquadStream: noop,
});

export function dbEventToEvent(e: Record<string, unknown>): Event {
  return {
    id: e.id as string,
    emoji: e.emoji as string,
    title: e.title as string,
    date: e.date as string,
    type: (e.type as Event["type"]) ?? "event",
    eventAt: (e.eventAt as string | null | undefined) ?? null,
    startAt: (e.startAt as string | null | undefined) ?? null,
    endAt: (e.endAt as string | null | undefined) ?? null,
    allDay: (e.allDay as boolean) ?? false,
    coverStyle: (e.coverStyle as string | undefined) ?? "",
    location: e.location as string,
    squadId: e.squadId as string,
    squadName: e.squadName as string,
    hostId: e.hostId as string,
    coAdminIds: (e.coAdminIds as string[]) ?? [],
    description: e.description as string,
    inviteCode: e.inviteCode as string,
    invitedUserIds: (e.invitedUserIds as string[]) ?? [],
    cancelled: (e.cancelled as boolean) ?? false,
    budget: e.budget ? Number(e.budget) : undefined,
    rsvps: (e.rsvps as Record<string, RsvpStatus>) ?? {},
    tasks: (e.tasks as Event["tasks"]) ?? [],
    costs: (e.costs as Event["costs"]) ?? [],
    polls: (e.polls as Event["polls"]) ?? [],
    messages: (e.messages as Event["messages"]) ?? [],
    itinerary: (e.itinerary as Event["itinerary"]) ?? [],
    packing: (e.packing as Event["packing"]) ?? [],
    isPublic: (e.isPublic as boolean) ?? false,
    version: (e.version as number) ?? 1,
  };
}

function dbSquadToSquad(s: Record<string, unknown>): Squad {
  return {
    id: s.id as string,
    name: s.name as string,
    description: (s.description as string | null | undefined) ?? null,
    emoji: s.emoji as string,
    color: s.color as string,
    memberIds: (s.memberIds as string[]) ?? [],
    isPublic: (s.isPublic as boolean) ?? false,
    creatorId: s.creatorId as string | undefined,
    coAdminIds: (s.coAdminIds as string[]) ?? [],
    inviteCode: s.inviteCode as string | null | undefined,
    membersCanInvite: (s.membersCanInvite as boolean) ?? false,
    muted: (s.muted as boolean) ?? false,
    version: (s.version as number) ?? 1,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // True until the startup AsyncStorage token check has settled (found or not).
  const [isAuthRestoring, setIsAuthRestoring] = useState(true);
  // True when a token exists but onboarding was never finished (registered then
  // closed the app). AuthGuard routes these users back into onboarding.
  const [pendingOnboarding, setPendingOnboarding] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [inviteCtx, setInviteCtx] = useState<InviteCtx | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [squadsLoading, setSquadsLoading] = useState(true);
  const [friends, setFriends] = useState<string[]>(INITIAL_FRIENDS);
  const [ownPaymentHandles, setOwnPaymentHandles] = useState<PaymentHandles>({ venmo: null, cashapp: null, zelle: null });
  const [conflictEventId, setConflictEventId] = useState<string | null>(null);
  const [conflictSnapshot, setConflictSnapshot] = useState<ConflictSnapshot | null>(null);
  const clearConflictEvent = useCallback(() => {
    setConflictEventId(null);
    setConflictSnapshot(null);
  }, []);
  const [conflictSquadId, setConflictSquadId] = useState<string | null>(null);
  const clearConflictSquad = useCallback(() => setConflictSquadId(null), []);
  // eventsRef is kept in sync with the latest events state (including optimistic updates)
  // so snapshot captures in async 409 handlers see the state the user was actually viewing.
  const eventsRef = useRef<Event[]>([]);
  useEffect(() => { eventsRef.current = events; }, [events]);
  const currentUserIdRef = useRef<string>(ME.id);
  // Always holds the latest auth token so async mutations can detect a
  // session change (logout/login) mid-flight and refuse to commit stale state.
  const authTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const isRefreshingRef = useRef(false);

  // apiFetch uses refs (not state) so it is stable across renders and all
  // callbacks that depend on it are created once. On 401 it attempts a single
  // token refresh and retries the original request.
  const apiFetch = useCallback(
    async (path: string, options?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
      };
      if (authTokenRef.current) headers.Authorization = `Bearer ${authTokenRef.current}`;
      const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

      if (res.status === 401 && refreshTokenRef.current && !isRefreshingRef.current) {
        isRefreshingRef.current = true;
        try {
          const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken: refreshTokenRef.current }),
          });
          if (refreshRes.ok) {
            const refreshData = (await refreshRes.json()) as { token?: string; refreshToken?: string };
            if (refreshData.token) {
              authTokenRef.current = refreshData.token;
              setAuthToken(refreshData.token);
              AsyncStorage.setItem(AUTH_TOKEN_KEY, refreshData.token).catch(() => {});
              if (refreshData.refreshToken) {
                refreshTokenRef.current = refreshData.refreshToken;
                AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshData.refreshToken).catch(() => {});
              }
              const retryHeaders = { ...headers, Authorization: `Bearer ${refreshData.token}` };
              return fetch(`${API_BASE}${path}`, { ...options, headers: retryHeaders });
            }
          }
          // Refresh rejected — force logout
          authTokenRef.current = null;
          refreshTokenRef.current = null;
          setAuthToken(null);
          setIsLoggedIn(false);
          setApiUser(null);
          AsyncStorage.multiRemove([AUTH_TOKEN_KEY, REFRESH_TOKEN_KEY]).catch(() => {});
        } catch {
          // Network error during refresh — leave state intact, caller handles
        } finally {
          isRefreshingRef.current = false;
        }
      }
      return res;
    },
    // No dependency on authToken state — uses authTokenRef so the function is
    // stable and all useCallbacks depending on it are created only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  // Friends are persisted server-side. fetchFriends is the single source of
  // truth: it refuses to commit if the auth session changed while the request
  // was in flight (prevents one account's friends leaking into another's UI).
  const fetchFriends = useCallback(async () => {
    const startedToken = authTokenRef.current;
    try {
      const res = await apiFetch("/api/users/friends");
      if (!res.ok) return;
      const data = (await res.json()) as { id: string }[];
      if (authTokenRef.current !== startedToken) return; // session changed mid-flight
      setFriends(data.map((u) => u.id));
    } catch {
      // Network unavailable — keep current list
    }
  }, [apiFetch]);

  // Optimistically apply, then reconcile with the server on failure. Using a
  // server re-fetch (rather than a blind local rollback) makes the result
  // order-independent: the persisted state always wins, even if mutations race.
  const addFriend = useCallback(
    (userId: string) => {
      setFriends((prev) => Array.from(new Set([...prev, userId])));
      void (async () => {
        try {
          const res = await apiFetch("/api/users/friends", {
            method: "POST",
            body: JSON.stringify({ friendId: userId }),
          });
          if (!res.ok) void fetchFriends();
        } catch {
          void fetchFriends();
        }
      })();
    },
    [apiFetch, fetchFriends],
  );

  const removeFriend = useCallback(
    (userId: string) => {
      setFriends((prev) => prev.filter((id) => id !== userId));
      void (async () => {
        try {
          const res = await apiFetch(`/api/users/friends/${encodeURIComponent(userId)}`, {
            method: "DELETE",
          });
          if (!res.ok) void fetchFriends();
        } catch {
          void fetchFriends();
        }
      })();
    },
    [apiFetch, fetchFriends],
  );

  useEffect(() => {
    if (authToken) void fetchFriends();
    else setFriends([]);
  }, [authToken, fetchFriends]);

  const fetchOwnHandles = useCallback(async () => {
    try {
      const res = await apiFetch("/api/user/preferences");
      if (!res.ok) return;
      const data = (await res.json()) as {
        venmoHandle?: string | null;
        cashappHandle?: string | null;
        zelleHandle?: string | null;
      };
      setOwnPaymentHandles({
        venmo: data.venmoHandle ?? null,
        cashapp: data.cashappHandle ?? null,
        zelle: data.zelleHandle ?? null,
      });
    } catch {
      // Network unavailable — keep current handles
    }
  }, [apiFetch]);

  const updateOwnPaymentHandles = useCallback((patch: Partial<PaymentHandles>) => {
    setOwnPaymentHandles((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (authToken) void fetchOwnHandles();
    else setOwnPaymentHandles({ venmo: null, cashapp: null, zelle: null });
  }, [authToken, fetchOwnHandles]);

  const fetchApiUser = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { user, emailVerified: verified, phone: userPhone } =
        (await res.json()) as {
          user: ApiUser | null;
          emailVerified?: boolean;
          phone?: string | null;
        };
      if (user) {
        setApiUser(user);
        setEmailVerified(Boolean(verified));
        setPhone(userPhone ?? null);
        currentUserIdRef.current = user.id;
      }
    } catch {
      // Network unavailable — fall back to mock identity
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const res = await apiFetch(`/api/events`);
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>[];
      setEvents(data.map(dbEventToEvent));
    } catch {
      // Network unavailable — keep mock data
    } finally {
      setEventsLoading(false);
    }
  }, [apiFetch]);

  // Silent refetch (no loading flicker) used for polling, e.g. live chat refresh.
  const refreshEvents = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/events`);
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>[];
      setEvents(data.map(dbEventToEvent));
    } catch {
      // Network unavailable — keep current data
    }
  }, [apiFetch]);

  const fetchSquads = useCallback(async () => {
    setSquadsLoading(true);
    try {
      const res = await apiFetch("/api/squads");
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>[];
      setSquads(data.map(dbSquadToSquad));
    } catch {
      // Network unavailable — keep mock data
    } finally {
      setSquadsLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    void fetchSquads();
  }, [fetchSquads]);

  useEffect(() => {
    if (authToken) {
      void fetchEvents();
      void fetchSquads();
    }
  }, [authToken, fetchEvents, fetchSquads]);

  // Silent squad refresh (no loading spinner) used for foreground polling.
  const refreshSquads = useCallback(async () => {
    try {
      const res = await apiFetch("/api/squads");
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>[];
      setSquads(data.map(dbSquadToSquad));
    } catch {
      // Network unavailable — keep current data
    }
  }, [apiFetch]);

  // Refresh squads whenever the app returns to the foreground so that users
  // who were just added to a squad see it immediately without a manual reload.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && isLoggedIn) void refreshSquads();
    });
    return () => sub.remove();
  }, [isLoggedIn, refreshSquads]);

  // Global squad stream — one SSE connection per session covering all of the
  // user's squads. Any mutation on any squad (PATCH, join, leave, add/remove
  // member) pushes an "update" event here, triggering refreshSquads() so that
  // every screen sharing AppContext (squad list, header, detail) updates
  // simultaneously without requiring a focus-switch to the detail screen.
  //
  // Auto-retries with exponential back-off (up to 30 s) when the connection
  // drops unexpectedly (server restart, network blip, proxy timeout), so users
  // don't silently miss live updates mid-session.
  const [squadStreamStatus, setSquadStreamStatus] = useState<"connected" | "reconnecting" | "error">("reconnecting");

  const globalStreamAbortRef = useRef<AbortController | null>(null);
  const globalStreamRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const globalStreamRetryCountRef = useRef(0);
  // Stable ref so the retry timer always calls the latest connect fn.
  const globalStreamConnectRef = useRef<() => void>(() => {});

  const MAX_GLOBAL_STREAM_RETRIES = 10;

  useEffect(() => {
    if (!isLoggedIn || !authToken) return;

    const token = authToken;

    const connect = () => {
      if (globalStreamRetryTimerRef.current !== null) {
        clearTimeout(globalStreamRetryTimerRef.current);
        globalStreamRetryTimerRef.current = null;
      }

      globalStreamAbortRef.current?.abort();

      const controller = new AbortController();
      globalStreamAbortRef.current = controller;

      setSquadStreamStatus("reconnecting");

      const scheduleRetry = () => {
        if (controller.signal.aborted) return;

        globalStreamRetryCountRef.current += 1;
        if (globalStreamRetryCountRef.current > MAX_GLOBAL_STREAM_RETRIES) {
          setSquadStreamStatus("error");
          return;
        }

        // Exponential back-off: 1 s, 2 s, 4 s, 8 s … capped at 30 s.
        const delay = Math.min(1000 * (2 ** (globalStreamRetryCountRef.current - 1)), 30_000);
        globalStreamRetryTimerRef.current = setTimeout(() => {
          globalStreamRetryTimerRef.current = null;
          globalStreamConnectRef.current();
        }, delay);
      };

      const run = async () => {
        try {
          const response = await streamFetch(`${API_BASE}/api/squads/stream`, {
            headers: {
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            scheduleRetry();
            return;
          }

          // Stream established — reset retry counter and announce "connected".
          globalStreamRetryCountRef.current = 0;
          setSquadStreamStatus("connected");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";

            for (const block of blocks) {
              if (block.includes("event: update")) {
                void refreshSquads();
              }
            }
          }

          reader.releaseLock();

          // Stream closed cleanly (server restart, proxy timeout, etc.) — retry.
          scheduleRetry();
        } catch (err) {
          // AbortError is expected on logout / token change — not a problem.
          if (err instanceof Error && err.name === "AbortError") return;
          scheduleRetry();
        }
      };

      void run();
    };

    globalStreamConnectRef.current = connect;
    globalStreamRetryCountRef.current = 0;
    connect();

    return () => {
      if (globalStreamRetryTimerRef.current !== null) {
        clearTimeout(globalStreamRetryTimerRef.current);
        globalStreamRetryTimerRef.current = null;
      }
      globalStreamAbortRef.current?.abort();
      globalStreamAbortRef.current = null;
    };
  }, [isLoggedIn, authToken, refreshSquads]);

  // Reset retry counter and reconnect immediately when the app returns to the
  // foreground — mobile OSes silently drop TCP connections in the background.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && isLoggedIn && authToken) {
        globalStreamRetryCountRef.current = 0;
        globalStreamConnectRef.current();
      }
    });
    return () => sub.remove();
  }, [isLoggedIn, authToken]);

  // Manual retry for the global squad stream — resets the back-off counter and
  // reconnects immediately. Backs the "Tap to retry" action on the live-status
  // banner shown on Home + Feed when the stream drops into the "error" state.
  const retrySquadStream = useCallback(() => {
    globalStreamRetryCountRef.current = 0;
    globalStreamConnectRef.current();
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([AUTH_TOKEN_KEY, ONBOARDING_PENDING_KEY]).then(entries => {
      const map = Object.fromEntries(entries) as Record<string, string | null>;
      const token = map[AUTH_TOKEN_KEY];
      if (token) {
        authTokenRef.current = token;
        setAuthToken(token);
        if (map[ONBOARDING_PENDING_KEY] === "1") {
          // Account exists server-side but onboarding was never finished —
          // resume onboarding rather than dropping the user into the app or login.
          setPendingOnboarding(true);
        } else {
          setIsLoggedIn(true);
        }
        void fetchApiUser(token);
        // Load the refresh token if present
        AsyncStorage.getItem(REFRESH_TOKEN_KEY).then(rt => {
          if (rt) refreshTokenRef.current = rt;
        }).catch(() => {});
      }
    }).catch(() => {}).finally(() => {
      // Signal AuthGuard that it is now safe to make routing decisions. Until
      // this fires, AuthGuard holds off redirecting so a stored session token
      // is honoured and the login screen never flashes on a warm relaunch.
      setIsAuthRestoring(false);
    });
  }, [fetchApiUser]);

  const refreshUser = useCallback(async () => {
    if (authToken) await fetchApiUser(authToken);
  }, [authToken, fetchApiUser]);

  const login = useCallback((token?: string) => {
    if (token) {
      AsyncStorage.setItem(AUTH_TOKEN_KEY, token).catch(() => {});
      setAuthToken(token);
      void fetchApiUser(token);
    }
    // Onboarding is finished — clear the pending marker so a future relaunch
    // sends the user straight into the app, not back through onboarding.
    AsyncStorage.removeItem(ONBOARDING_PENDING_KEY).catch(() => {});
    setPendingOnboarding(false);
    setIsLoggedIn(true);
  }, [fetchApiUser]);

  // Persist a token + the auth payload returned by register/login. Avoids an
  // extra /auth/me round-trip on the happy path. `markLoggedIn` is true for
  // login (go straight to the app) but false for register, which routes through
  // onboarding first — onboarding's login() flips the flag once setup is done,
  // avoiding an AuthGuard race that would yank the user out of signup early.
  const applyAuthSession = useCallback(
    (
      token: string,
      payload: { user: ApiUser; emailVerified?: boolean; phone?: string | null },
      markLoggedIn: boolean,
      refreshToken?: string | null,
    ) => {
      AsyncStorage.setItem(AUTH_TOKEN_KEY, token).catch(() => {});
      authTokenRef.current = token;
      if (refreshToken) {
        AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken).catch(() => {});
        refreshTokenRef.current = refreshToken;
      }
      setAuthToken(token);
      setApiUser(payload.user);
      setEmailVerified(Boolean(payload.emailVerified));
      setPhone(payload.phone ?? null);
      currentUserIdRef.current = payload.user.id;
      if (markLoggedIn) {
        AsyncStorage.removeItem(ONBOARDING_PENDING_KEY).catch(() => {});
        setPendingOnboarding(false);
        setIsLoggedIn(true);
      } else {
        // Register path: token is live but onboarding hasn't been completed.
        // Mark it so a relaunch before finishing resumes onboarding.
        AsyncStorage.setItem(ONBOARDING_PENDING_KEY, "1").catch(() => {});
        setPendingOnboarding(true);
      }
    },
    [],
  );

  const registerWithEmail = useCallback(
    async (input: {
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    }): Promise<AuthResult> => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = (await res.json().catch(() => ({}))) as {
          token?: string;
          refreshToken?: string;
          user?: ApiUser;
          emailVerified?: boolean;
          phone?: string | null;
          error?: string;
        };
        if (!res.ok || !data.token || !data.user) {
          return { ok: false, error: data.error ?? "Couldn't create your account. Please try again." };
        }
        applyAuthSession(
          data.token,
          { user: data.user, emailVerified: data.emailVerified, phone: data.phone },
          false,
          data.refreshToken,
        );
        identify(data.user.id, { email: data.user.email ?? undefined });
        track("signup", { method: "email" });
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Please check your connection and try again." };
      }
    },
    [applyAuthSession],
  );

  const loginWithEmail = useCallback(
    async (email: string, password: string): Promise<AuthResult> => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          token?: string;
          refreshToken?: string;
          user?: ApiUser;
          emailVerified?: boolean;
          phone?: string | null;
          error?: string;
        };
        if (!res.ok || !data.token || !data.user) {
          return { ok: false, error: data.error ?? "Incorrect email or password." };
        }
        applyAuthSession(
          data.token,
          { user: data.user, emailVerified: data.emailVerified, phone: data.phone },
          true,
          data.refreshToken,
        );
        identify(data.user.id, { email: data.user.email ?? undefined });
        track("login", { method: "email" });
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Please check your connection and try again." };
      }
    },
    [applyAuthSession],
  );

  const forgotPassword = useCallback(async (email: string): Promise<AuthResult> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? "Couldn't send the reset email. Please try again." };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please check your connection and try again." };
    }
  }, []);

  const resendVerification = useCallback(async (): Promise<AuthResult> => {
    if (!authToken) return { ok: false, error: "You're not signed in." };
    try {
      const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return { ok: false, error: "Couldn't resend the email. Please try again." };
      return { ok: true };
    } catch {
      return { ok: false, error: "Network error. Please check your connection and try again." };
    }
  }, [authToken]);

  const logout = useCallback(() => {
    const token = authToken;
    track("logout");
    analyticsReset();
    if (token) {
      // Fire-and-forget server-side session teardown.
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    AsyncStorage.multiRemove(ALL_APP_STORAGE_KEYS).catch(() => {});
    clearProfileCache();
    authTokenRef.current = null;
    refreshTokenRef.current = null;
    setAuthToken(null);
    setApiUser(null);
    setEmailVerified(false);
    setPhone(null);
    setEvents([]);
    setSquads([]);
    setIsLoggedIn(false);
    setPendingOnboarding(false);
    setOwnPaymentHandles({ venmo: null, cashapp: null, zelle: null });
    currentUserIdRef.current = ME.id;
  }, [authToken]);

  // Permanently delete the account server-side, then tear down the local session
  // exactly like logout (minus the server logout call, whose session is already
  // gone). Returns an AuthResult so the caller can surface a precise error.
  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    const token = authToken;
    if (!token) return { ok: false, error: "You're not signed in." };
    try {
      const res = await fetch(`${API_BASE}/api/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: data.error ?? "Couldn't delete your account. Please try again." };
      }
    } catch {
      return { ok: false, error: "Network error. Please check your connection and try again." };
    }
    track("account_deleted");
    analyticsReset();
    AsyncStorage.multiRemove(ALL_APP_STORAGE_KEYS).catch(() => {});
    clearProfileCache();
    authTokenRef.current = null;
    refreshTokenRef.current = null;
    setAuthToken(null);
    setApiUser(null);
    setEmailVerified(false);
    setPhone(null);
    setEvents([]);
    setSquads([]);
    setIsLoggedIn(false);
    setPendingOnboarding(false);
    setOwnPaymentHandles({ venmo: null, cashapp: null, zelle: null });
    currentUserIdRef.current = ME.id;
    return { ok: true };
  }, [authToken]);

  const applyEventUpdate = useCallback((updated: Record<string, unknown>) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updated.id ? dbEventToEvent(updated) : e)),
    );
  }, []);

  const getEvent = useCallback(
    (id: string) => events.find((e) => e.id === id),
    [events],
  );

  const setRsvp = useCallback(
    (eventId: string, status: RsvpStatus) => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const currentVersion = events.find((e) => e.id === eventId)?.version;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, rsvps: { ...e.rsvps, [userId]: status } } : e,
        ),
      );
      const body: Record<string, unknown> = { userId, status };
      if (currentVersion !== undefined) body.version = currentVersion;
      void apiFetch(`/api/events/${eventId}/rsvp`, {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (res.status === 409) {
            const data = await res.json() as { error?: string; conflict?: boolean };
            if (data.conflict) {
              showToast(data.error ?? "Someone else just updated this", { durationMs: 8000, action: { label: "Refresh", onPress: () => void refreshEvents() } });
              return;
            }
            return Promise.reject();
          }
          if (!res.ok) return Promise.reject();
          return res.json() as Promise<Record<string, unknown>>;
        })
        .then((data) => { if (data) applyEventUpdate(data); })
        .catch(() => { void refreshEvents(); showToast("Couldn't save your RSVP — please try again"); });
    },
    [apiFetch, applyEventUpdate, apiUser, events, refreshEvents, showToast],
  );

  // Invite friends directly to an existing trip/event. The server validates each
  // target (friend-or-squad-member) and returns the updated event, which we map
  // into state (so newly-invited people show up immediately).
  const inviteToEvent = useCallback(
    async (eventId: string, userIds: string[]): Promise<{ error?: string }> => {
      if (userIds.length === 0) return {};
      try {
        const res = await apiFetch(`/api/events/${eventId}/invite`, {
          method: "POST",
          body: JSON.stringify({ userIds }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { error: data.error ?? "Couldn't send the invite" };
        }
        const data = (await res.json()) as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        return { error: "Couldn't send the invite — please try again" };
      }
    },
    [apiFetch, applyEventUpdate],
  );

  // Remove a personal invite (host removing anyone, or the invitee leaving).
  const uninviteFromEvent = useCallback(
    async (eventId: string, userId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/events/${eventId}/invite/${userId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { error: data.error ?? "Couldn't remove the invite" };
        }
        const data = (await res.json()) as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        return { error: "Couldn't remove the invite — please try again" };
      }
    },
    [apiFetch, applyEventUpdate],
  );

  const addEvent = useCallback(async (input: NewEventInput): Promise<string> => {
    const squad = squads.find((s) => s.id === input.squadId);
    const hostId = apiUser?.id ?? currentUserIdRef.current;
    const isTrip = input.type === "trip";
    const body = {
      emoji: input.emoji,
      title: input.title,
      date: input.date || "Date TBD",
      ...(input.eventAt ? { eventAt: input.eventAt } : {}),
      location: input.location || "Location TBD",
      squadId: squad?.id ?? "",
      squadName: squad?.name ?? "Personal",
      hostId,
      description: input.description ?? "",
      isPublic: input.isPublic ?? false,
      ...(isTrip ? { type: "trip" } : {}),
      ...(input.startAt ? { startAt: input.startAt } : {}),
      ...(input.endAt ? { endAt: input.endAt } : {}),
      ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
      ...(input.coverStyle ? { coverStyle: input.coverStyle } : {}),
      ...(input.itinerary && input.itinerary.length > 0 ? { itinerary: input.itinerary } : {}),
      ...(input.invitedUserIds && input.invitedUserIds.length > 0
        ? { invitedUserIds: input.invitedUserIds }
        : {}),
    };

    let res: Response;
    try {
      res = await apiFetch("/api/events", { method: "POST", body: JSON.stringify(body) });
    } catch {
      // True network/offline error — fall back to a local-only event so the
      // user can still see what they entered while offline.
      const id = `e${Date.now()}`;
      const newEvent: Event = {
        id,
        emoji: input.emoji,
        title: input.title,
        date: input.date || "Date TBD",
        type: input.type === "trip" ? "trip" : "event",
        eventAt: input.eventAt ?? input.startAt ?? null,
        startAt: input.startAt ?? null,
        endAt: input.endAt ?? null,
        allDay: input.allDay ?? false,
        coverStyle: input.coverStyle ?? "",
        location: input.location || "Location TBD",
        squadId: squad?.id ?? "",
        squadName: squad?.name ?? "Personal",
        hostId,
        rsvps: { [hostId]: "going" },
        invitedUserIds: input.invitedUserIds ?? [],
        description: input.description ?? "",
        inviteCode: `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        tasks: [],
        costs: [],
        polls: [],
        messages: [],
        itinerary: input.itinerary ?? [],
        packing: [],
        version: 1,
      };
      setEvents((prev) => [newEvent, ...prev]);
      return id;
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error ?? `Server error ${res.status}`);
    }

    const event = await res.json() as Record<string, unknown>;
    const mapped = dbEventToEvent(event);
    setEvents((prev) => [{ ...mapped, rsvps: { ...mapped.rsvps, [hostId]: "going" } }, ...prev]);
    return mapped.id;
  }, [squads, apiFetch, apiUser]);

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget" | "isPublic" | "startAt" | "endAt" | "eventAt" | "allDay" | "coverStyle" | "squadId">>, explicitVersion?: number) => {
      const currentVersion = explicitVersion ?? events.find((e) => e.id === eventId)?.version;
      // Optimistic update
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, ...patch } : e)));
      const body = currentVersion !== undefined ? { ...patch, version: currentVersion } : patch;
      void apiFetch(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) })
        .then(async (res) => {
          if (res.status === 409) {
            const data = await res.json() as { error?: string; conflict?: boolean };
            if (data.conflict) {
              const snap = eventsRef.current.find((e) => e.id === eventId);
              if (snap) setConflictSnapshot({ eventId, title: snap.title, date: snap.date, location: snap.location, description: snap.description, tasks: snap.tasks.map((t) => ({ ...t })) });
              showToast("Someone else just updated this — showing latest");
              void refreshEvents().then(() => setConflictEventId(eventId));
              return;
            }
            return Promise.reject();
          }
          if (!res.ok) return Promise.reject();
          return res.json() as Promise<Record<string, unknown>>;
        })
        .then((data) => { if (data) applyEventUpdate(data); })
        .catch(() => { void refreshEvents(); showToast("Couldn't save changes — please try again"); });
    },
    [events, apiFetch, applyEventUpdate, refreshEvents, showToast],
  );

  const addEventCoAdmin = useCallback(
    async (eventId: string, userId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/events/${eventId}/co-admins`, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { error: data.error ?? "Couldn't add co-admin. Please try again." };
        }
        applyEventUpdate(await res.json() as Record<string, unknown>);
        return {};
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch, applyEventUpdate],
  );

  const removeEventCoAdmin = useCallback(
    async (eventId: string, userId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/events/${eventId}/co-admins/${userId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { error: data.error ?? "Couldn't remove co-admin. Please try again." };
        }
        applyEventUpdate(await res.json() as Record<string, unknown>);
        return {};
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch, applyEventUpdate],
  );

  const addSquadCoAdmin = useCallback(
    async (squadId: string, userId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/squads/${squadId}/co-admins`, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { error: data.error ?? "Couldn't add co-admin. Please try again." };
        }
        const updated = dbSquadToSquad(await res.json() as Record<string, unknown>);
        setSquads((prev) => prev.map((s) => (s.id === squadId ? { ...updated, muted: s.muted } : s)));
        return {};
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch],
  );

  const removeSquadCoAdmin = useCallback(
    async (squadId: string, userId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/squads/${squadId}/co-admins/${userId}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          return { error: data.error ?? "Couldn't remove co-admin. Please try again." };
        }
        const updated = dbSquadToSquad(await res.json() as Record<string, unknown>);
        setSquads((prev) => prev.map((s) => (s.id === squadId ? { ...updated, muted: s.muted } : s)));
        return {};
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch],
  );

  const joinEvent = useCallback(async (inviteCode: string): Promise<{ error?: string }> => {
    try {
      const res = await apiFetch("/api/events/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode: inviteCode.trim().toUpperCase() }),
      });
      if (res.status === 404) return { error: "Code not found. Double-check it and try again." };
      if (!res.ok) return { error: "Something went wrong. Please try again." };
      const event = await res.json() as Record<string, unknown>;
      const mapped = dbEventToEvent(event);
      setEvents((prev) => {
        if (prev.some((e) => e.id === mapped.id)) {
          return prev.map((e) => (e.id === mapped.id ? mapped : e));
        }
        return [mapped, ...prev];
      });
      return {};
    } catch {
      return { error: "Network error. Please try again." };
    }
  }, [apiFetch]);

  const cancelEvent = useCallback((eventId: string) => {
    // Optimistic removal
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
    void apiFetch(`/api/events/${eventId}`, { method: "DELETE" })
      .then((res) => { if (!res.ok) { void refreshEvents(); showToast("Couldn't cancel event — please try again"); } })
      .catch(() => { void refreshEvents(); showToast("Couldn't cancel event — please try again"); });
  }, [apiFetch, refreshEvents]);

  const toggleTask = useCallback(
    async (eventId: string, taskId: string): Promise<void> => {
      const event = events.find((e) => e.id === eventId);
      const task = event?.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const currentVersion = event?.version;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
            : e,
        ),
      );
      const body: Record<string, unknown> = { done: !task.done };
      if (currentVersion !== undefined) body.version = currentVersion;
      try {
        const res = await apiFetch(`/api/events/${eventId}/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
            const data = await res.json() as { error?: string; conflict?: boolean };
            if (data.conflict) {
              const snap = eventsRef.current.find((e) => e.id === eventId);
              if (snap) setConflictSnapshot({ eventId, title: snap.title, date: snap.date, location: snap.location, description: snap.description, tasks: snap.tasks.map((t) => ({ ...t })) });
              showToast("Someone else just updated this — showing latest");
              void refreshEvents().then(() => setConflictEventId(eventId));
              return;
            }
            throw new Error("conflict");
          }
          if (!res.ok) throw new Error();
          applyEventUpdate(await (res.json() as Promise<Record<string, unknown>>));
        } catch (err) {
          if ((err as Error).message !== "conflict") {
            void refreshEvents();
            showToast("Couldn't update task — please try again");
          }
        }
    },
    [events, apiFetch, applyEventUpdate, refreshEvents, showToast],
  );

  const claimTask = useCallback(
    async (eventId: string, taskId: string): Promise<void> => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const currentVersion = events.find((e) => e.id === eventId)?.version;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, assigneeId: userId } : t)) }
            : e,
        ),
      );
      const body: Record<string, unknown> = { assigneeId: userId };
      if (currentVersion !== undefined) body.version = currentVersion;
      try {
        const res = await apiFetch(`/api/events/${eventId}/tasks/${taskId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          const data = await res.json() as { error?: string; conflict?: boolean };
          if (data.conflict) {
            const snap = eventsRef.current.find((e) => e.id === eventId);
            if (snap) setConflictSnapshot({ eventId, title: snap.title, date: snap.date, location: snap.location, description: snap.description, tasks: snap.tasks.map((t) => ({ ...t })) });
            showToast("Someone else just updated this — showing latest");
            void refreshEvents().then(() => setConflictEventId(eventId));
            return;
          }
          throw new Error("conflict");
        }
        if (!res.ok) throw new Error();
        applyEventUpdate(await (res.json() as Promise<Record<string, unknown>>));
      } catch (err) {
        if ((err as Error).message !== "conflict") {
          void refreshEvents();
          showToast("Couldn't claim task — please try again");
        }
      }
    },
    [events, apiFetch, applyEventUpdate, apiUser, refreshEvents, showToast],
  );

  const addTask = useCallback(
    async (eventId: string, title: string, category?: string): Promise<{ error?: string }> => {
      const tempId = `t${Date.now()}`;
      const currentVersion = events.find((e) => e.id === eventId)?.version;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: [...e.tasks, { id: tempId, title, assigneeId: null, done: false, ...(category ? { category } : {}) }] }
            : e,
        ),
      );
      try {
        const res = await apiFetch(`/api/events/${eventId}/tasks`, {
          method: "POST",
          body: JSON.stringify({ title, ...(category ? { category } : {}), ...(currentVersion !== undefined ? { version: currentVersion } : {}) }),
        });
        if (res.status === 409) {
          // Revert the optimistic task
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, tasks: e.tasks.filter((t) => t.id !== tempId) } : e,
            ),
          );
          const snap = eventsRef.current.find((e) => e.id === eventId);
          if (snap) setConflictSnapshot({ eventId, title: snap.title, date: snap.date, location: snap.location, description: snap.description, tasks: snap.tasks.map((t) => ({ ...t })) });
          showToast("Someone else just updated this — showing latest");
          void refreshEvents().then(() => setConflictEventId(eventId));
          return { error: "Update conflict" };
        }
        if (!res.ok) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, tasks: e.tasks.filter((t) => t.id !== tempId) } : e,
            ),
          );
          let message = "Could not save task. Please try again.";
          try {
            const body = await res.json() as { error?: string };
            if (body.error) message = body.error;
          } catch { /* ignore */ }
          showToast(message);
          return { error: message };
        }
        const data = await res.json() as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId ? { ...e, tasks: e.tasks.filter((t) => t.id !== tempId) } : e,
          ),
        );
        showToast("Could not save task. Check your connection and try again.");
        return { error: "Could not save task. Check your connection and try again." };
      }
    },
    [apiFetch, applyEventUpdate, events, refreshEvents, showToast],
  );

  const addCost = useCallback(
    async (eventId: string, input: { description: string; amount: number; shares: CostShare[] }, explicitVersion?: number): Promise<{ error?: string }> => {
      const hasInvalid = input.shares.some((s) => s.amount < 0);
      const assigned = input.shares.reduce((sum, s) => sum + s.amount, 0);
      if (input.amount <= 0 || hasInvalid || Math.abs(input.amount - assigned) >= 0.01)
        return { error: "Invalid cost input." };
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const currentVersion = explicitVersion ?? events.find((e) => e.id === eventId)?.version;
      const tempId = `c${Date.now()}`;
      const cost: Cost = {
        id: tempId,
        description: input.description,
        amount: input.amount,
        paidById: userId,
        shares: input.shares,
      };
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, costs: [...e.costs, cost] } : e)),
      );
      try {
        const body: Record<string, unknown> = { ...input, paidById: userId };
        if (currentVersion !== undefined) body.version = currentVersion;
        const res = await apiFetch(`/api/events/${eventId}/costs`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, costs: e.costs.filter((c) => c.id !== tempId) } : e,
            ),
          );
          showToast("Someone else just updated this", { durationMs: 8000, action: { label: "Refresh", onPress: () => void refreshEvents() } });
          return { error: "Update conflict" };
        }
        if (!res.ok) {
          // Roll back the optimistic cost
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, costs: e.costs.filter((c) => c.id !== tempId) } : e,
            ),
          );
          let message = "Could not save expense. Please try again.";
          try {
            const errBody = await res.json() as { error?: string };
            if (errBody.error) message = errBody.error;
          } catch { /* ignore parse errors */ }
          return { error: message };
        }
        const data = await res.json() as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        // Roll back the optimistic cost on network error
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId ? { ...e, costs: e.costs.filter((c) => c.id !== tempId) } : e,
          ),
        );
        return { error: "Could not save expense. Check your connection and try again." };
      }
    },
    [apiFetch, applyEventUpdate, apiUser, events, refreshEvents],
  );

  const markSharePaid = useCallback(
    (eventId: string, costId: string, paid: boolean, explicitVersion?: number) => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const nowIso = new Date().toISOString();
      // Optimistic update: stamp/clear my own share on this cost.
      setEvents((prev) =>
        prev.map((e) =>
          e.id !== eventId
            ? e
            : {
                ...e,
                costs: e.costs.map((c) =>
                  c.id !== costId
                    ? c
                    : {
                        ...c,
                        shares: c.shares.map((s) =>
                          s.userId === userId ? { ...s, paidAt: paid ? nowIso : null } : s,
                        ),
                      },
                ),
              },
        ),
      );
      const currentVersion = explicitVersion ?? events.find((e) => e.id === eventId)?.version;
      const body: Record<string, unknown> = { paid };
      if (currentVersion !== undefined) body.version = currentVersion;
      void apiFetch(`/api/events/${eventId}/costs/${costId}/mark-paid`, {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : Promise.reject()))
        .then(applyEventUpdate)
        .catch(() => {
          void refreshEvents();
        });
    },
    [apiFetch, applyEventUpdate, apiUser, events, refreshEvents],
  );

  const confirmShare = useCallback(
    (eventId: string, costId: string, debtorId: string, confirmed: boolean, explicitVersion?: number) => {
      const nowIso = new Date().toISOString();
      // Optimistic update: confirm sets confirmedAt; un-mark clears both stamps.
      setEvents((prev) =>
        prev.map((e) =>
          e.id !== eventId
            ? e
            : {
                ...e,
                costs: e.costs.map((c) =>
                  c.id !== costId
                    ? c
                    : {
                        ...c,
                        shares: c.shares.map((s) =>
                          s.userId !== debtorId
                            ? s
                            : confirmed
                              ? { ...s, confirmedAt: nowIso }
                              : { ...s, paidAt: null, confirmedAt: null },
                        ),
                      },
                ),
              },
        ),
      );
      const currentVersion = explicitVersion ?? events.find((e) => e.id === eventId)?.version;
      const body: Record<string, unknown> = { confirmed };
      if (currentVersion !== undefined) body.version = currentVersion;
      void apiFetch(`/api/events/${eventId}/costs/${costId}/shares/${encodeURIComponent(debtorId)}/confirm`, {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then((res) => (res.ok ? (res.json() as Promise<Record<string, unknown>>) : Promise.reject()))
        .then(applyEventUpdate)
        .catch(() => {
          void refreshEvents();
        });
    },
    [apiFetch, applyEventUpdate, events, refreshEvents],
  );

  const fetchPaymentHandles = useCallback(
    async (
      eventId: string,
    ): Promise<Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>> => {
      try {
        const res = await apiFetch(`/api/events/${eventId}/payment-handles`);
        if (!res.ok) return {};
        const data = (await res.json()) as {
          handles?: Record<string, { venmo: string | null; cashapp: string | null; zelle: string | null }>;
        };
        return data.handles ?? {};
      } catch {
        return {};
      }
    },
    [apiFetch],
  );

  const addPoll = useCallback(
    async (eventId: string, question: string, options: string[]): Promise<{ error?: string }> => {
      const tempId = `p${Date.now()}`;
      const tempPoll = {
        id: tempId,
        question,
        options: options.map((label, i) => ({ id: `po${Date.now()}${i}`, label, voterIds: [] })),
      };
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, polls: [...e.polls, tempPoll] } : e,
        ),
      );
      try {
        const res = await apiFetch(`/api/events/${eventId}/polls`, {
          method: "POST",
          body: JSON.stringify({ question, options }),
        });
        if (!res.ok) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, polls: e.polls.filter((p) => p.id !== tempId) } : e,
            ),
          );
          let message = "Could not save poll. Please try again.";
          try {
            const body = await res.json() as { error?: string };
            if (body.error) message = body.error;
          } catch { /* ignore */ }
          return { error: message };
        }
        const data = await res.json() as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId ? { ...e, polls: e.polls.filter((p) => p.id !== tempId) } : e,
          ),
        );
        return { error: "Could not save poll. Check your connection and try again." };
      }
    },
    [apiFetch, applyEventUpdate],
  );

  const votePoll = useCallback(
    (eventId: string, pollId: string, optionId: string) => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const currentVersion = events.find((e) => e.id === eventId)?.version;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id !== eventId
            ? e
            : {
                ...e,
                polls: e.polls.map((poll) =>
                  poll.id !== pollId
                    ? poll
                    : {
                        ...poll,
                        options: poll.options.map((o) => ({
                          ...o,
                          voterIds:
                            o.id === optionId
                              ? Array.from(new Set([...o.voterIds, userId]))
                              : o.voterIds.filter((v) => v !== userId),
                        })),
                      },
                ),
              },
        ),
      );
      const body: Record<string, unknown> = { userId, optionId };
      if (currentVersion !== undefined) body.version = currentVersion;
      void apiFetch(`/api/events/${eventId}/polls/${pollId}/vote`, {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (res.status === 409) {
            const data = await res.json() as { error?: string; conflict?: boolean };
            if (data.conflict) {
              showToast(data.error ?? "Someone else just updated this", { durationMs: 8000, action: { label: "Refresh", onPress: () => void refreshEvents() } });
              return;
            }
            return Promise.reject();
          }
          if (!res.ok) return Promise.reject();
          return res.json() as Promise<Record<string, unknown>>;
        })
        .then((data) => { if (data) applyEventUpdate(data); })
        .catch(() => { void refreshEvents(); showToast("Couldn't save your vote — please try again"); });
    },
    [apiFetch, applyEventUpdate, apiUser, events, refreshEvents, showToast],
  );

  const sendMessage = useCallback(
    async (eventId: string, text: string): Promise<{ error?: string }> => {
      const senderId = apiUser?.id ?? currentUserIdRef.current;
      const currentVersion = events.find((e) => e.id === eventId)?.version;
      const tempId = `m${Date.now()}`;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, messages: [...e.messages, { id: tempId, senderId, text, time: "Just now" }] }
            : e,
        ),
      );
      try {
        const body: Record<string, unknown> = { senderId, text };
        if (currentVersion !== undefined) body.version = currentVersion;
        const res = await apiFetch(`/api/events/${eventId}/messages`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, messages: e.messages.filter((m) => m.id !== tempId) } : e,
            ),
          );
          showToast("Someone else just updated this", { durationMs: 8000, action: { label: "Refresh", onPress: () => void refreshEvents() } });
          return { error: "Update conflict" };
        }
        if (!res.ok) {
          setEvents((prev) =>
            prev.map((e) =>
              e.id === eventId ? { ...e, messages: e.messages.filter((m) => m.id !== tempId) } : e,
            ),
          );
          let message = "Could not send message. Please try again.";
          try {
            const errBody = await res.json() as { error?: string };
            if (errBody.error) message = errBody.error;
          } catch { /* ignore */ }
          return { error: message };
        }
        const data = await res.json() as Record<string, unknown>;
        applyEventUpdate(data);
        return {};
      } catch {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId ? { ...e, messages: e.messages.filter((m) => m.id !== tempId) } : e,
          ),
        );
        return { error: "Could not send message. Check your connection and try again." };
      }
    },
    [apiFetch, applyEventUpdate, apiUser, events, refreshEvents],
  );

  const getSquad = useCallback(
    (sid: string) => squads.find((s) => s.id === sid),
    [squads],
  );

  const addSquad = useCallback(async (input: { name: string; description?: string; emoji: string; color: string; isPublic?: boolean }): Promise<string> => {
    const userId = apiUser?.id ?? currentUserIdRef.current;
    const optimisticFallback = (): string => {
      const id = `s${Date.now()}`;
      const newSquad: Squad = { id, name: input.name, description: input.description ?? null, emoji: input.emoji, color: input.color, memberIds: [userId], isPublic: input.isPublic ?? false };
      setSquads((prev) => [...prev, newSquad]);
      return id;
    };
    let res: Awaited<ReturnType<typeof apiFetch>>;
    try {
      res = await apiFetch("/api/squads", {
        method: "POST",
        body: JSON.stringify({ ...input, memberIds: [userId] }),
      });
    } catch {
      // Network failure — fall back to an optimistic local squad.
      return optimisticFallback();
    }
    // Free squad limit reached — surface to the caller so it can prompt an upgrade
    // instead of silently creating an optimistic local squad.
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "SQUAD_LIMIT") throw new SquadLimitError();
      return optimisticFallback();
    }
    if (!res.ok) return optimisticFallback();
    const squad = await res.json() as Record<string, unknown>;
    const mapped = dbSquadToSquad(squad);
    setSquads((prev) => [...prev, mapped]);
    return mapped.id;
  }, [apiFetch, apiUser]);

  const updateSquad = useCallback(
    (sid: string, patch: Partial<Pick<Squad, "name" | "description" | "emoji" | "color" | "isPublic" | "membersCanInvite">>) => {
      // Optimistic update
      const currentVersion = squads.find((s) => s.id === sid)?.version;
      const body = currentVersion !== undefined ? { ...patch, version: currentVersion } : patch;
      setSquads((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
      void apiFetch(`/api/squads/${sid}`, { method: "PATCH", body: JSON.stringify(body) })
        .then(async (res) => {
          if (res.status === 409) {
            const data = await res.json() as { error?: string; conflict?: boolean };
            if (data.conflict) {
              showToast("Someone else just updated this — showing latest");
              setConflictSquadId(sid);
              void refreshSquads();
              return;
            }
            return Promise.reject();
          }
          if (!res.ok) return Promise.reject();
          return res.json() as Promise<Record<string, unknown>>;
        })
        .then((updated) => {
          if (updated) setSquads((prev) => prev.map((s) => (s.id === sid ? dbSquadToSquad(updated) : s)));
        })
        .catch(() => { void refreshSquads(); showToast("Couldn't save changes — please try again"); });
    },
    [apiFetch, refreshSquads, showToast, squads],
  );

  const regenerateInviteCode = useCallback(async (squadId: string): Promise<{ error?: string; inviteCode?: string }> => {
    try {
      const res = await apiFetch(`/api/squads/${squadId}/invite/regenerate`, { method: "POST" });
      if (res.status === 403) return { error: "Only the squad creator can regenerate the invite link." };
      if (!res.ok) return { error: "Something went wrong. Please try again." };
      const updated = await res.json() as Record<string, unknown>;
      const newSquad = dbSquadToSquad(updated);
      setSquads((prev) => prev.map((s) => (s.id === squadId ? newSquad : s)));
      return { inviteCode: newSquad.inviteCode ?? undefined };
    } catch {
      return { error: "Network error. Please try again." };
    }
  }, [apiFetch]);

  const leaveSquad = useCallback((sid: string) => {
    const selfId = currentUserIdRef.current;
    // Optimistically remove the squad. If the server rejects the leave (or the
    // request fails), reconcile from the server — which is authoritative — so the
    // squad reappears if we are in fact still a member. Reconciling instead of
    // re-inserting a cached copy avoids a stale restore under overlapping calls.
    setSquads((prev) => prev.filter((s) => s.id !== sid));
    void apiFetch(`/api/squads/${sid}/members/${selfId}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) void refreshSquads();
      })
      .catch(() => {
        void refreshSquads();
      });
  }, [apiFetch, refreshSquads]);

  const joinSquad = useCallback(async (squadId: string): Promise<{ error?: string }> => {
    let res: Awaited<ReturnType<typeof apiFetch>>;
    try {
      res = await apiFetch(`/api/squads/${squadId}/join`, { method: "POST" });
    } catch {
      return { error: "Network error. Please try again." };
    }
    // Free squad limit reached — throw so callers can prompt an upgrade (matches
    // createSquad). Other 403s are the squad simply not being open to new members.
    if (res.status === 403) {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "SQUAD_LIMIT") throw new SquadLimitError();
      return { error: "This squad is not open to new members." };
    }
    if (!res.ok) return { error: "Something went wrong. Please try again." };
    const squad = await res.json() as Record<string, unknown>;
    const mapped = dbSquadToSquad(squad);
    setSquads((prev) => {
      if (prev.some((s) => s.id === mapped.id)) return prev.map((s) => s.id === mapped.id ? mapped : s);
      return [...prev, mapped];
    });
    return {};
  }, [apiFetch]);

  const removeMember = useCallback(
    async (squadId: string, targetUserId: string): Promise<{ error?: string }> => {
      try {
        const res = await apiFetch(`/api/squads/${squadId}/members/${targetUserId}`, { method: "DELETE" });
        const data = (await res.json().catch(() => ({}))) as { memberIds?: string[]; deleted?: boolean; error?: string } & Record<string, unknown>;
        if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
        // The squad was deleted server-side (the last member left) — drop it locally.
        if (data.deleted) {
          setSquads((prev) => prev.filter((s) => s.id !== squadId));
          return {};
        }
        setSquads((prev) =>
          prev.map((s) => {
            if (s.id !== squadId) return s;
            return dbSquadToSquad(data);
          }),
        );
        return {};
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch],
  );

  const joinSquadByCode = useCallback(
    async (code: string): Promise<{ error?: string; revoked?: boolean; limit?: boolean; squad?: Squad; alreadyMember?: boolean }> => {
      try {
        const res = await apiFetch("/api/squads/join-via-code", {
          method: "POST",
          body: JSON.stringify({ code: code.trim().toUpperCase() }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          squad?: Record<string, unknown>;
          alreadyMember?: boolean;
          error?: string;
          code?: string;
        };
        if (!res.ok) {
          if (res.status === 404) return { error: data.error ?? "This invite link has been revoked.", revoked: true };
          if (res.status === 403 && data.code === "SQUAD_LIMIT") return { limit: true };
          return { error: data.error ?? "Something went wrong. Please try again." };
        }
        const mapped = data.squad ? dbSquadToSquad(data.squad) : undefined;
        if (mapped) {
          setSquads((prev) => {
            if (prev.some((s) => s.id === mapped.id)) return prev.map((s) => (s.id === mapped.id ? mapped : s));
            return [...prev, mapped];
          });
        }
        return { squad: mapped, alreadyMember: data.alreadyMember ?? false };
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch],
  );

  const addMemberByFriendCode = useCallback(
    async (squadId: string, friendCode: string): Promise<{ error?: string; user?: FoundUser }> => {
      try {
        const res = await apiFetch(`/api/squads/${squadId}/members`, {
          method: "POST",
          body: JSON.stringify({ friendCode }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          squad?: Record<string, unknown>;
          addedUser?: FoundUser;
          error?: string;
        };
        if (res.status === 409) {
          showToast(data.error ?? "That user is already in the squad.");
          setConflictSquadId(squadId);
          void refreshSquads();
          return {};
        }
        if (res.status === 404) return { error: data.error ?? "No user found with that friend code." };
        if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
        if (data.squad) {
          const mapped = dbSquadToSquad(data.squad);
          setSquads((prev) => prev.map((s) => (s.id === mapped.id ? mapped : s)));
        }
        return { user: data.addedUser };
      } catch {
        return { error: "Network error. Please try again." };
      }
    },
    [apiFetch, refreshSquads, showToast],
  );

  const currentUser = apiUser
    ? {
        id: apiUser.id,
        name: getUserName(apiUser),
        initials: getInitials(apiUser),
        color: colorFromId(apiUser.id),
        avatar: getInitials(apiUser),
        profileImageUrl: apiUser.profileImageUrl,
      }
    : ME;

  const outstandingBalancesCount = useMemo(() => {
    const meId = currentUser.id;
    let count = 0;
    for (const ev of events) {
      if (!ev.costs || ev.costs.length === 0) continue;
      let hasOutstanding = false;
      for (const cost of ev.costs) {
        for (const share of cost.shares) {
          if (cost.paidById !== meId && share.userId === meId && share.amount > 0 && !share.paidAt) {
            hasOutstanding = true;
            break;
          } else if (cost.paidById === meId && share.userId !== meId && share.amount > 0 && !share.confirmedAt) {
            hasOutstanding = true;
            break;
          }
        }
        if (hasOutstanding) break;
      }
      if (hasOutstanding) count += 1;
    }
    return count;
  }, [events, currentUser.id]);

  const value = useMemo(
    () => ({
      isLoggedIn,
      isAuthRestoring,
      pendingOnboarding,
      currentUser,
      inviteCtx,
      authToken,
      emailVerified,
      phone,
      login,
      registerWithEmail,
      loginWithEmail,
      forgotPassword,
      resendVerification,
      logout,
      deleteAccount,
      refreshUser,
      setInviteCtx,
      eventsLoading,
      squadsLoading,
      events,
      getEvent,
      setRsvp,
      addEvent,
      updateEvent,
      addEventCoAdmin,
      removeEventCoAdmin,
      addSquadCoAdmin,
      removeSquadCoAdmin,
      joinEvent,
      inviteToEvent,
      uninviteFromEvent,
      cancelEvent,
      toggleTask,
      claimTask,
      addTask,
      addCost,
      markSharePaid,
      confirmShare,
      ownPaymentHandles,
      updateOwnPaymentHandles,
      fetchPaymentHandles,
      addPoll,
      votePoll,
      sendMessage,
      refreshEvents,
      refreshSquads,
      conflictEventId,
      conflictSnapshot,
      clearConflictEvent,
      conflictSquadId,
      clearConflictSquad,
      squads,
      getSquad,
      addSquad,
      updateSquad,
      regenerateInviteCode,
      leaveSquad,
      joinSquad,
      joinSquadByCode,
      addMemberByFriendCode,
      removeMember,
      friends,
      friendCode: apiUser?.friendCode ?? "",
      addFriend,
      removeFriend,
      outstandingBalancesCount,
      squadStreamStatus,
      retrySquadStream,
    }),
    [
      isLoggedIn,
      isAuthRestoring,
      pendingOnboarding,
      currentUser,
      inviteCtx,
      authToken,
      emailVerified,
      phone,
      login,
      registerWithEmail,
      loginWithEmail,
      forgotPassword,
      resendVerification,
      logout,
      deleteAccount,
      refreshUser,
      setInviteCtx,
      eventsLoading,
      squadsLoading,
      events,
      getEvent,
      setRsvp,
      addEvent,
      updateEvent,
      addEventCoAdmin,
      removeEventCoAdmin,
      addSquadCoAdmin,
      removeSquadCoAdmin,
      joinEvent,
      inviteToEvent,
      uninviteFromEvent,
      cancelEvent,
      toggleTask,
      claimTask,
      addTask,
      addCost,
      markSharePaid,
      confirmShare,
      ownPaymentHandles,
      updateOwnPaymentHandles,
      fetchPaymentHandles,
      addPoll,
      votePoll,
      sendMessage,
      refreshEvents,
      refreshSquads,
      conflictEventId,
      conflictSnapshot,
      clearConflictEvent,
      conflictSquadId,
      clearConflictSquad,
      squads,
      getSquad,
      addSquad,
      updateSquad,
      regenerateInviteCode,
      leaveSquad,
      joinSquad,
      joinSquadByCode,
      addMemberByFriendCode,
      removeMember,
      friends,
      apiUser,
      addFriend,
      removeFriend,
      outstandingBalancesCount,
      squadStreamStatus,
      retrySquadStream,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export const useAuth = () => useContext(AppContext);
export const useData = () => useContext(AppContext);
