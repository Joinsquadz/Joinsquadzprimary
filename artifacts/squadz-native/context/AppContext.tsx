import React, { createContext, useContext, useState, useCallback } from "react";
import {
  ME,
  EVENTS,
  SQUADS,
  type Event,
  type RsvpStatus,
  type Cost,
  type CostShare,
} from "@/data/mock";

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
  login: () => void;
  logout: () => void;
  setInviteCtx: (ctx: InviteCtx | null) => void;

  events: Event[];
  getEvent: (id: string) => Event | undefined;
  setRsvp: (eventId: string, status: RsvpStatus) => void;
  addEvent: (input: NewEventInput) => string;
  updateEvent: (
    eventId: string,
    patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji">>,
  ) => void;
  cancelEvent: (eventId: string) => void;
  toggleTask: (eventId: string, taskId: string) => void;
  claimTask: (eventId: string, taskId: string) => void;
  addTask: (eventId: string, title: string) => void;
  addCost: (eventId: string, input: { description: string; amount: number; shares: CostShare[] }) => void;
  addPoll: (eventId: string, question: string, options: string[]) => void;
  votePoll: (eventId: string, pollId: string, optionId: string) => void;
  sendMessage: (eventId: string, text: string) => void;
};

const noop = () => {};

const AppContext = createContext<AppContextType>({
  isLoggedIn: false,
  currentUser: ME,
  inviteCtx: null,
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
  const [inviteCtx, setInviteCtx] = useState<InviteCtx | null>(null);
  const [events, setEvents] = useState<Event[]>(() =>
    EVENTS.map((e) => ({ ...e, rsvps: { ...e.rsvps } })),
  );

  const login = useCallback(() => setIsLoggedIn(true), []);
  const logout = useCallback(() => setIsLoggedIn(false), []);

  const patchEvent = useCallback((eventId: string, fn: (e: Event) => Event) => {
    setEvents((prev) => prev.map((e) => (e.id === eventId ? fn(e) : e)));
  }, []);

  const getEvent = useCallback(
    (id: string) => events.find((e) => e.id === id),
    [events],
  );

  const setRsvp = useCallback(
    (eventId: string, status: RsvpStatus) => {
      patchEvent(eventId, (e) => ({
        ...e,
        rsvps: { ...e.rsvps, [ME.id]: status },
      }));
    },
    [patchEvent],
  );

  const addEvent = useCallback((input: NewEventInput) => {
    const id = nextId("e");
    const squad = SQUADS.find((s) => s.id === input.squadId);
    const newEvent: Event = {
      id,
      emoji: input.emoji,
      title: input.title,
      date: input.date || "Date TBD",
      location: input.location || "Location TBD",
      squadId: squad?.id ?? "s1",
      squadName: squad?.name ?? "The Usual Suspects",
      hostId: ME.id,
      rsvps: { [ME.id]: "going" },
      description: input.description ?? "",
      inviteCode: randomCode(),
      tasks: [],
      costs: [],
      polls: [],
      messages: [],
    };
    setEvents((prev) => [newEvent, ...prev]);
    return id;
  }, []);

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<Pick<Event, "title" | "description" | "date" | "location" | "emoji">>) => {
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
      patchEvent(eventId, (e) => ({
        ...e,
        tasks: e.tasks.map((t) => (t.id === taskId ? { ...t, assigneeId: ME.id } : t)),
      }));
    },
    [patchEvent],
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
        paidById: ME.id,
        shares: input.shares,
      };
      patchEvent(eventId, (e) => ({ ...e, costs: [...e.costs, cost] }));
    },
    [patchEvent],
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
                      ? Array.from(new Set([...o.voterIds, ME.id]))
                      : o.voterIds.filter((v) => v !== ME.id),
                })),
              },
        ),
      }));
    },
    [patchEvent],
  );

  const sendMessage = useCallback(
    (eventId: string, text: string) => {
      patchEvent(eventId, (e) => ({
        ...e,
        messages: [...e.messages, { id: nextId("m"), senderId: ME.id, text, time: "Just now" }],
      }));
    },
    [patchEvent],
  );

  return (
    <AppContext.Provider
      value={{
        isLoggedIn,
        currentUser: ME,
        inviteCtx,
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
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export const useAuth = () => useContext(AppContext);
export const useData = () => useContext(AppContext);
