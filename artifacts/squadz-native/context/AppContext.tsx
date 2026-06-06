import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  ME,
  EVENTS,
  SQUADS,
  type Event,
  type Squad,
  type RsvpStatus,
  type Cost,
  type CostShare,
} from "@/data/mock";

const AUTH_TOKEN_KEY = "@squadz/authToken";

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

function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  if (Platform.OS === "web") return "";
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}

const API_BASE = resolveApiBase();

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

type AppContextType = {
  isLoggedIn: boolean;
  currentUser: typeof ME;
  inviteCtx: InviteCtx | null;
  authToken: string | null;
  login: (token?: string) => void;
  logout: () => void;
  setInviteCtx: (ctx: InviteCtx | null) => void;

  events: Event[];
  getEvent: (id: string) => Event | undefined;
  setRsvp: (eventId: string, status: RsvpStatus) => void;
  addEvent: (input: NewEventInput) => string;
  updateEvent: (
    eventId: string,
    patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget">>,
  ) => void;
  cancelEvent: (eventId: string) => void;
  toggleTask: (eventId: string, taskId: string) => void;
  claimTask: (eventId: string, taskId: string) => void;
  addTask: (eventId: string, title: string) => void;
  addCost: (eventId: string, input: { description: string; amount: number; shares: CostShare[] }) => void;
  addPoll: (eventId: string, question: string, options: string[]) => void;
  votePoll: (eventId: string, pollId: string, optionId: string) => void;
  sendMessage: (eventId: string, text: string) => void;

  squads: Squad[];
  getSquad: (id: string) => Squad | undefined;
  addSquad: (input: { name: string; emoji: string; color: string }) => string;
  updateSquad: (id: string, patch: Partial<Pick<Squad, "name" | "emoji" | "color">>) => void;
  leaveSquad: (id: string) => void;

  friends: string[];
  friendCode: string;
  addFriend: (userId: string) => void;
  removeFriend: (userId: string) => void;
};

const noop = () => {};

const MY_FRIEND_CODE = "SQ-JP42";
const INITIAL_FRIENDS = ["u1", "u3"];

const AppContext = createContext<AppContextType>({
  isLoggedIn: false,
  currentUser: ME,
  inviteCtx: null,
  authToken: null,
  login: noop,
  logout: noop,
  setInviteCtx: noop,
  events: EVENTS,
  getEvent: () => undefined,
  setRsvp: noop,
  addEvent: () => "",
  updateEvent: noop,
  cancelEvent: noop,
  toggleTask: noop,
  claimTask: noop,
  addTask: noop,
  addCost: noop,
  addPoll: noop,
  votePoll: noop,
  sendMessage: noop,
  squads: SQUADS,
  getSquad: () => undefined,
  addSquad: () => "",
  updateSquad: noop,
  leaveSquad: noop,
  friends: INITIAL_FRIENDS,
  friendCode: MY_FRIEND_CODE,
  addFriend: noop,
  removeFriend: noop,
});

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}${++idCounter}`;

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `SQ-${out}`;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [apiUser, setApiUser] = useState<ApiUser | null>(null);
  const [inviteCtx, setInviteCtx] = useState<InviteCtx | null>(null);
  const [events, setEvents] = useState<Event[]>(() =>
    EVENTS.map((e) => ({ ...e, rsvps: { ...e.rsvps } })),
  );
  const [squads, setSquads] = useState<Squad[]>(() =>
    SQUADS.map((s) => ({ ...s, memberIds: [...s.memberIds] })),
  );
  const [friends, setFriends] = useState<string[]>(INITIAL_FRIENDS);

  const addFriend = useCallback((userId: string) => {
    setFriends((prev) => Array.from(new Set([...prev, userId])));
  }, []);

  const removeFriend = useCallback((userId: string) => {
    setFriends((prev) => prev.filter((id) => id !== userId));
  }, []);

  const fetchApiUser = useCallback(async (token: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { user } = await res.json() as { user: ApiUser | null };
      if (user) setApiUser(user);
    } catch {
      // Network unavailable — fall back to mock identity
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(AUTH_TOKEN_KEY).then(token => {
      if (token) {
        setAuthToken(token);
        setIsLoggedIn(true);
        void fetchApiUser(token);
      }
    }).catch(() => {});
  }, [fetchApiUser]);

  const login = useCallback((token?: string) => {
    if (token) {
      AsyncStorage.setItem(AUTH_TOKEN_KEY, token).catch(() => {});
      setAuthToken(token);
      void fetchApiUser(token);
    }
    setIsLoggedIn(true);
  }, [fetchApiUser]);

  const logout = useCallback(() => {
    AsyncStorage.removeItem(AUTH_TOKEN_KEY).catch(() => {});
    setAuthToken(null);
    setApiUser(null);
    setIsLoggedIn(false);
  }, []);

  const patchEvent = useCallback((eventId: string, fn: (e: Event) => Event) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? fn(e) : e)));
  }, []);

  const getEvent = useCallback(
    (id: string) => events.find((e) => e.id === id),
    [events],
  );

  const setRsvp = useCallback(
    (eventId: string, status: RsvpStatus) => {
      const uid = apiUser?.id ?? ME.id;
      patchEvent(eventId, (e) => ({
        ...e,
        rsvps: { ...e.rsvps, [uid]: status },
      }));
    },
    [patchEvent, apiUser],
  );

  const addEvent = useCallback((input: NewEventInput) => {
    const uid = apiUser?.id ?? ME.id;
    const id = nextId("e");
    const squad = squads.find((s) => s.id === input.squadId);
    const newEvent: Event = {
      id,
      emoji: input.emoji,
      title: input.title,
      date: input.date || "Date TBD",
      location: input.location || "Location TBD",
      squadId: squad?.id ?? "",
      squadName: squad?.name ?? "Personal",
      hostId: uid,
      rsvps: { [uid]: "going" },
      description: input.description ?? "",
      inviteCode: randomCode(),
      tasks: [],
      costs: [],
      polls: [],
      messages: [],
    };
    setEvents((prev) => [newEvent, ...prev]);
    return id;
  }, [squads, apiUser]);

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji" | "budget">>) => {
      patchEvent(eventId, (e) => ({ ...e, ...patch }));
    },
    [patchEvent],
  );

  const cancelEvent = useCallback((eventId: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  }, []);

  const toggleTask = useCallback(
    (eventId: string, taskId: string) => {
      patchEvent(eventId, (e) => ({
        ...e,
        tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
      }));
    },
    [patchEvent],
  );

  const claimTask = useCallback(
    (eventId: string, taskId: string) => {
      const uid = apiUser?.id ?? ME.id;
      patchEvent(eventId, (e) => ({
        ...e,
        tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, assigneeId: uid } : t)),
      }));
    },
    [patchEvent, apiUser],
  );

  const addTask = useCallback(
    (eventId: string, title: string) => {
      patchEvent(eventId, (e) => ({
        ...e,
        tasks: [...e.tasks, { id: nextId("t"), title, assigneeId: null, done: false }],
      }));
    },
    [patchEvent],
  );

  const addCost = useCallback(
    (eventId: string, input: { description: string; amount: number; shares: CostShare[] }) => {
      const hasInvalid = input.shares.some((s) => s.amount < 0);
      const assigned = input.shares.reduce((sum, s) => sum + s.amount, 0);
      if (input.amount <= 0 || hasInvalid || Math.abs(input.amount - assigned) >= 0.01) {
        return;
      }
      const cost: Cost = {
        id: nextId("c"),
        description: input.description,
        amount: input.amount,
        paidById: apiUser?.id ?? ME.id,
        shares: input.shares,
      };
      patchEvent(eventId, (e) => ({ ...e, costs: [...e.costs, cost] }));
    },
    [patchEvent, apiUser],
  );

  const addPoll = useCallback(
    (eventId: string, question: string, options: string[]) => {
      patchEvent(eventId, (e) => ({
        ...e,
        polls: [
          ...e.polls,
          {
            id: nextId("p"),
            question,
            options: options.map((label) => ({ id: nextId("po"), label, voterIds: [] })),
          },
        ],
      }));
    },
    [patchEvent],
  );

  const votePoll = useCallback(
    (eventId: string, pollId: string, optionId: string) => {
      const uid = apiUser?.id ?? ME.id;
      patchEvent(eventId, (e) => ({
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
                      ? Array.from(new Set([...o.voterIds, uid]))
                      : o.voterIds.filter((v) => v !== uid),
                })),
              },
        ),
      }));
    },
    [patchEvent, apiUser],
  );

  const sendMessage = useCallback(
    (eventId: string, text: string) => {
      const uid = apiUser?.id ?? ME.id;
      patchEvent(eventId, (e) => ({
        ...e,
        messages: [...e.messages, { id: nextId("m"), senderId: uid, text, time: "Just now" }],
      }));
    },
    [patchEvent, apiUser],
  );

  const getSquad = useCallback(
    (sid: string) => squads.find((s) => s.id === sid),
    [squads],
  );

  const addSquad = useCallback((input: { name: string; emoji: string; color: string }) => {
    const uid = apiUser?.id ?? ME.id;
    const id = nextId("s");
    const newSquad: Squad = {
      id,
      name: input.name,
      emoji: input.emoji,
      color: input.color,
      memberIds: [uid],
    };
    setSquads((prev) => [...prev, newSquad]);
    return id;
  }, [apiUser]);

  const updateSquad = useCallback(
    (sid: string, patch: Partial<Pick<Squad, "name" | "emoji" | "color">>) => {
      setSquads((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
    },
    [],
  );

  const leaveSquad = useCallback((sid: string) => {
    setSquads((prev) => prev.filter((s) => s.id !== sid));
  }, []);

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
        login,
        logout,
        setInviteCtx,
        events,
        getEvent,
        setRsvp,
        addEvent,
        updateEvent,
        cancelEvent,
        toggleTask,
        claimTask,
        addTask,
        addCost,
        addPoll,
        votePoll,
        sendMessage,
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
