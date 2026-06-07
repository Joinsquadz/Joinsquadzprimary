import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/lib/api";
import {
  ME,
  type Event,
  type Squad,
  type RsvpStatus,
  type Cost,
  type CostShare,
} from "@/data/mock";

const AUTH_TOKEN_KEY = "@squadz/authToken";

// All app-level AsyncStorage keys. Add new keys here so they are
// automatically cleared on logout, preventing data leaking between accounts.
const ALL_APP_STORAGE_KEYS: string[] = [
  AUTH_TOKEN_KEY,
];

type ApiUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
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

function getInitials(u: ApiUser): string {
  if (u.firstName && u.lastName) return `${u.firstName[0]}${u.lastName[0]}`.toUpperCase();
  if (u.firstName) return u.firstName.slice(0, 2).toUpperCase();
  if (u.email) return u.email.slice(0, 2).toUpperCase();
  return "U?";
}

function getUserName(u: ApiUser): string {
  if (u.firstName && u.lastName) return `${u.firstName} ${u.lastName}`;
  if (u.firstName) return u.firstName;
  return u.email ?? "Unknown User";
}

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
  location: string;
  description?: string;
  squadId: string | null;
};

type AuthResult = { ok: boolean; error?: string };

type AppContextType = {
  isLoggedIn: boolean;
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
    patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget">>,
  ) => void;
  joinEvent: (inviteCode: string) => Promise<{ error?: string }>;
  cancelEvent: (eventId: string) => void;
  toggleTask: (eventId: string, taskId: string) => void;
  claimTask: (eventId: string, taskId: string) => void;
  addTask: (eventId: string, title: string) => void;
  addCost: (eventId: string, input: { description: string; amount: number; shares: CostShare[] }) => void;
  addPoll: (eventId: string, question: string, options: string[]) => void;
  votePoll: (eventId: string, pollId: string, optionId: string) => void;
  sendMessage: (eventId: string, text: string) => void;
  refreshEvents: () => Promise<void>;

  squads: Squad[];
  getSquad: (id: string) => Squad | undefined;
  addSquad: (input: { name: string; emoji: string; color: string }) => Promise<string>;
  updateSquad: (id: string, patch: Partial<Pick<Squad, "name" | "emoji" | "color">>) => void;
  leaveSquad: (id: string) => void;

  friends: string[];
  friendCode: string;
  addFriend: (userId: string) => void;
  removeFriend: (userId: string) => void;
};

const noop = () => {};
const asyncNoop = async () => "";

const MY_FRIEND_CODE = "SQ-JP42";
const INITIAL_FRIENDS = ["u1", "u3"];

const AppContext = createContext<AppContextType>({
  isLoggedIn: false,
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
  refreshUser: async () => {},
  setInviteCtx: noop,
  eventsLoading: true,
  squadsLoading: true,
  events: [],
  getEvent: () => undefined,
  setRsvp: noop,
  addEvent: asyncNoop,
  updateEvent: noop,
  joinEvent: async () => ({}),
  cancelEvent: noop,
  toggleTask: noop,
  claimTask: noop,
  addTask: noop,
  addCost: noop,
  addPoll: noop,
  votePoll: noop,
  sendMessage: noop,
  refreshEvents: async () => {},
  squads: [],
  getSquad: () => undefined,
  addSquad: asyncNoop,
  updateSquad: noop,
  leaveSquad: noop,
  friends: INITIAL_FRIENDS,
  friendCode: MY_FRIEND_CODE,
  addFriend: noop,
  removeFriend: noop,
});

function dbEventToEvent(e: Record<string, unknown>): Event {
  return {
    id: e.id as string,
    emoji: e.emoji as string,
    title: e.title as string,
    date: e.date as string,
    location: e.location as string,
    squadId: e.squadId as string,
    squadName: e.squadName as string,
    hostId: e.hostId as string,
    description: e.description as string,
    inviteCode: e.inviteCode as string,
    cancelled: (e.cancelled as boolean) ?? false,
    budget: e.budget ? Number(e.budget) : undefined,
    rsvps: (e.rsvps as Record<string, RsvpStatus>) ?? {},
    tasks: (e.tasks as Event["tasks"]) ?? [],
    costs: (e.costs as Event["costs"]) ?? [],
    polls: (e.polls as Event["polls"]) ?? [],
    messages: (e.messages as Event["messages"]) ?? [],
  };
}

function dbSquadToSquad(s: Record<string, unknown>): Squad {
  return {
    id: s.id as string,
    name: s.name as string,
    emoji: s.emoji as string,
    color: s.color as string,
    memberIds: (s.memberIds as string[]) ?? [],
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
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
  const currentUserIdRef = useRef<string>(ME.id);

  const addFriend = useCallback((userId: string) => {
    setFriends((prev) => Array.from(new Set([...prev, userId])));
  }, []);

  const removeFriend = useCallback((userId: string) => {
    setFriends((prev) => prev.filter((id) => id !== userId));
  }, []);

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
      };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      return fetch(`${API_BASE}${path}`, { ...options, headers });
    },
    [authToken],
  );

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

  useEffect(() => {
    AsyncStorage.getItem(AUTH_TOKEN_KEY).then(token => {
      if (token) {
        setAuthToken(token);
        setIsLoggedIn(true);
        void fetchApiUser(token);
      }
    }).catch(() => {});
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
    ) => {
      AsyncStorage.setItem(AUTH_TOKEN_KEY, token).catch(() => {});
      setAuthToken(token);
      setApiUser(payload.user);
      setEmailVerified(Boolean(payload.emailVerified));
      setPhone(payload.phone ?? null);
      currentUserIdRef.current = payload.user.id;
      if (markLoggedIn) setIsLoggedIn(true);
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
        );
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
        );
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
    if (token) {
      // Fire-and-forget server-side session teardown.
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    AsyncStorage.multiRemove(ALL_APP_STORAGE_KEYS).catch(() => {});
    setAuthToken(null);
    setApiUser(null);
    setEmailVerified(false);
    setPhone(null);
    setEvents([]);
    setSquads([]);
    setIsLoggedIn(false);
    currentUserIdRef.current = ME.id;
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
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, rsvps: { ...e.rsvps, [userId]: status } } : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ userId, status }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate, apiUser],
  );

  const addEvent = useCallback(async (input: NewEventInput): Promise<string> => {
    const squad = squads.find((s) => s.id === input.squadId);
    const hostId = apiUser?.id ?? currentUserIdRef.current;
    const body = {
      emoji: input.emoji,
      title: input.title,
      date: input.date || "Date TBD",
      location: input.location || "Location TBD",
      squadId: squad?.id ?? "",
      squadName: squad?.name ?? "Personal",
      hostId,
      description: input.description ?? "",
    };
    try {
      const res = await apiFetch("/api/events", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new Error("Failed to create event");
      const event = await res.json() as Record<string, unknown>;
      const mapped = dbEventToEvent(event);
      // Add initial RSVP for the host
      setEvents((prev) => [{ ...mapped, rsvps: { ...mapped.rsvps, [hostId]: "going" } }, ...prev]);
      return mapped.id;
    } catch {
      // Fallback: local only
      const id = `e${Date.now()}`;
      const newEvent: Event = {
        id,
        emoji: input.emoji,
        title: input.title,
        date: input.date || "Date TBD",
        location: input.location || "Location TBD",
        squadId: squad?.id ?? "",
        squadName: squad?.name ?? "Personal",
        hostId,
        rsvps: { [hostId]: "going" },
        description: input.description ?? "",
        inviteCode: `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        tasks: [],
        costs: [],
        polls: [],
        messages: [],
      };
      setEvents((prev) => [newEvent, ...prev]);
      return id;
    }
  }, [squads, apiFetch, apiUser]);

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget">>) => {
      // Optimistic update
      setEvents((prev) => prev.map((e) => (e.id === eventId ? { ...e, ...patch } : e)));
      void apiFetch(`/api/events/${eventId}`, { method: "PATCH", body: JSON.stringify(patch) })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate],
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
    void apiFetch(`/api/events/${eventId}`, { method: "DELETE" }).catch(() => {});
  }, [apiFetch]);

  const toggleTask = useCallback(
    (eventId: string, taskId: string) => {
      const event = events.find((e) => e.id === eventId);
      const task = event?.tasks.find((t) => t.id === taskId);
      if (!task) return;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) }
            : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ done: !task.done }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [events, apiFetch, applyEventUpdate],
  );

  const claimTask = useCallback(
    (eventId: string, taskId: string) => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, assigneeId: userId } : t)) }
            : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ assigneeId: userId }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate, apiUser],
  );

  const addTask = useCallback(
    (eventId: string, title: string) => {
      // Optimistic update
      const tempId = `t${Date.now()}`;
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, tasks: [...e.tasks, { id: tempId, title, assigneeId: null, done: false }] }
            : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate],
  );

  const addCost = useCallback(
    (eventId: string, input: { description: string; amount: number; shares: CostShare[] }) => {
      const hasInvalid = input.shares.some((s) => s.amount < 0);
      const assigned = input.shares.reduce((sum, s) => sum + s.amount, 0);
      if (input.amount <= 0 || hasInvalid || Math.abs(input.amount - assigned) >= 0.01) return;
      const userId = apiUser?.id ?? currentUserIdRef.current;
      const cost: Cost = {
        id: `c${Date.now()}`,
        description: input.description,
        amount: input.amount,
        paidById: userId,
        shares: input.shares,
      };
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, costs: [...e.costs, cost] } : e)),
      );
      void apiFetch(`/api/events/${eventId}/costs`, {
        method: "POST",
        body: JSON.stringify({ ...input, paidById: userId }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate, apiUser],
  );

  const addPoll = useCallback(
    (eventId: string, question: string, options: string[]) => {
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? {
                ...e,
                polls: [
                  ...e.polls,
                  {
                    id: `p${Date.now()}`,
                    question,
                    options: options.map((label, i) => ({ id: `po${Date.now()}${i}`, label, voterIds: [] })),
                  },
                ],
              }
            : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/polls`, {
        method: "POST",
        body: JSON.stringify({ question, options }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate],
  );

  const votePoll = useCallback(
    (eventId: string, pollId: string, optionId: string) => {
      const userId = apiUser?.id ?? currentUserIdRef.current;
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
      void apiFetch(`/api/events/${eventId}/polls/${pollId}/vote`, {
        method: "POST",
        body: JSON.stringify({ userId, optionId }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate, apiUser],
  );

  const sendMessage = useCallback(
    (eventId: string, text: string) => {
      const senderId = apiUser?.id ?? currentUserIdRef.current;
      // Optimistic update
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId
            ? { ...e, messages: [...e.messages, { id: `m${Date.now()}`, senderId, text, time: "Just now" }] }
            : e,
        ),
      );
      void apiFetch(`/api/events/${eventId}/messages`, {
        method: "POST",
        body: JSON.stringify({ senderId, text }),
      })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then(applyEventUpdate)
        .catch(() => {});
    },
    [apiFetch, applyEventUpdate, apiUser],
  );

  const getSquad = useCallback(
    (sid: string) => squads.find((s) => s.id === sid),
    [squads],
  );

  const addSquad = useCallback(async (input: { name: string; emoji: string; color: string }): Promise<string> => {
    const userId = apiUser?.id ?? currentUserIdRef.current;
    try {
      const res = await apiFetch("/api/squads", {
        method: "POST",
        body: JSON.stringify({ ...input, memberIds: [userId] }),
      });
      if (!res.ok) throw new Error("Failed to create squad");
      const squad = await res.json() as Record<string, unknown>;
      const mapped = dbSquadToSquad(squad);
      setSquads((prev) => [...prev, mapped]);
      return mapped.id;
    } catch {
      const id = `s${Date.now()}`;
      const newSquad: Squad = { id, name: input.name, emoji: input.emoji, color: input.color, memberIds: [userId] };
      setSquads((prev) => [...prev, newSquad]);
      return id;
    }
  }, [apiFetch, apiUser]);

  const updateSquad = useCallback(
    (sid: string, patch: Partial<Pick<Squad, "name" | "emoji" | "color">>) => {
      // Optimistic update
      setSquads((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
      void apiFetch(`/api/squads/${sid}`, { method: "PATCH", body: JSON.stringify(patch) })
        .then((res) => res.ok ? res.json() as Promise<Record<string, unknown>> : Promise.reject())
        .then((updated) => {
          setSquads((prev) => prev.map((s) => (s.id === sid ? dbSquadToSquad(updated) : s)));
        })
        .catch(() => {});
    },
    [apiFetch],
  );

  const leaveSquad = useCallback((sid: string) => {
    setSquads((prev) => prev.filter((s) => s.id !== sid));
    void apiFetch(`/api/squads/${sid}`, { method: "DELETE" }).catch(() => {});
  }, [apiFetch]);

  const currentUser = apiUser
    ? {
        id: apiUser.id,
        name: getUserName(apiUser),
        initials: getInitials(apiUser),
        color: colorFromId(apiUser.id),
        avatar: getInitials(apiUser),
      }
    : ME;

  return (
    <AppContext.Provider
      value={{
        isLoggedIn,
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
        refreshUser,
        setInviteCtx,
        eventsLoading,
        squadsLoading,
        events,
        getEvent,
        setRsvp,
        addEvent,
        updateEvent,
        joinEvent,
        cancelEvent,
        toggleTask,
        claimTask,
        addTask,
        addCost,
        addPoll,
        votePoll,
        sendMessage,
        refreshEvents,
        squads,
        getSquad,
        addSquad,
        updateSquad,
        leaveSquad,
        friends,
        friendCode: MY_FRIEND_CODE,
        addFriend,
        removeFriend,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAuth = () => useContext(AppContext);
export const useData = () => useContext(AppContext);
