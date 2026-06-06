export type User = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type RsvpStatus = "going" | "maybe" | "notgoing";

export type Task = {
  id: string;
  title: string;
  assigneeId: string | null;
  done: boolean;
};

export type CostShare = {
  userId: string;
  amount: number;
};

export type Cost = {
  id: string;
  description: string;
  amount: number;
  paidById: string;
  shares: CostShare[];
};

export type PollOption = {
  id: string;
  label: string;
  voterIds: string[];
};

export type Poll = {
  id: string;
  question: string;
  options: PollOption[];
};

export type Message = {
  id: string;
  senderId: string;
  text: string;
  time: string;
};

export type Event = {
  id: string;
  emoji: string;
  title: string;
  date: string;
  location: string;
  squadId: string;
  squadName: string;
  hostId: string;
  rsvps: Record<string, RsvpStatus>;
  description: string;
  inviteCode: string;
  tasks: Task[];
  costs: Cost[];
  polls: Poll[];
  messages: Message[];
  cancelled?: boolean;
};

export type Squad = {
  id: string;
  name: string;
  emoji: string;
  memberIds: string[];
  color: string;
};

export const USERS: User[] = [
  { id: "me", name: "Jordan Park", initials: "JP", color: "#FF5C3A" },
  { id: "u1", name: "Marcus Chen", initials: "MC", color: "#4A9EFF" },
  { id: "u2", name: "Alex Chen", initials: "AC", color: "#2ECC8A" },
  { id: "u3", name: "Sarah Kim", initials: "SK", color: "#A855F7" },
  { id: "u4", name: "Jamie Lee", initials: "JL", color: "#FFB547" },
  { id: "u5", name: "Tyler Ross", initials: "TR", color: "#FF5C3A" },
];

export const SQUADS: Squad[] = [
  { id: "s1", name: "The Usual Suspects", emoji: "🔥", memberIds: ["me", "u1", "u2", "u3", "u4", "u5"], color: "#FF5C3A" },
  { id: "s2", name: "College Squad", emoji: "🎓", memberIds: ["me", "u2", "u3"], color: "#4A9EFF" },
  { id: "s3", name: "Work Crew", emoji: "💼", memberIds: ["me", "u1", "u4"], color: "#2ECC8A" },
];

function rsvpsAllGoing(ids: string[]): Record<string, RsvpStatus> {
  return ids.reduce((acc, id) => ({ ...acc, [id]: "going" }), {} as Record<string, RsvpStatus>);
}

export const EVENTS: Event[] = [
  {
    id: "e1",
    emoji: "🔥",
    title: "Rooftop BBQ",
    date: "Sat, Jun 7 · 5:00 PM",
    location: "123 Main St, Rooftop",
    squadId: "s1",
    squadName: "The Usual Suspects",
    hostId: "u1",
    rsvps: { ...rsvpsAllGoing(["u1", "u2", "u3", "u4"]), me: "going", u5: "maybe" },
    description: "Annual rooftop BBQ! Bring your A-game grilling skills. We'll have burgers, drinks, and an amazing sunset view over the city.",
    inviteCode: "BBQ-7K2M",
    tasks: [
      { id: "t1", title: "Bring charcoal", assigneeId: "u1", done: true },
      { id: "t2", title: "Buy drinks", assigneeId: "me", done: false },
      { id: "t3", title: "Get ice", assigneeId: "u2", done: false },
      { id: "t9", title: "Bring a speaker", assigneeId: null, done: false },
    ],
    costs: [
      {
        id: "c1",
        description: "Meat & veggies",
        amount: 85,
        paidById: "u1",
        shares: [
          { userId: "me", amount: 17 },
          { userId: "u1", amount: 17 },
          { userId: "u2", amount: 17 },
          { userId: "u3", amount: 17 },
          { userId: "u4", amount: 17 },
        ],
      },
      {
        id: "c2",
        description: "Drinks",
        amount: 45,
        paidById: "me",
        shares: [
          { userId: "me", amount: 9 },
          { userId: "u1", amount: 9 },
          { userId: "u2", amount: 9 },
          { userId: "u3", amount: 9 },
          { userId: "u4", amount: 9 },
        ],
      },
    ],
    polls: [
      {
        id: "p1",
        question: "What time should we fire up the grill?",
        options: [
          { id: "po1", label: "5:00 PM", voterIds: ["u1", "u2"] },
          { id: "po2", label: "6:00 PM", voterIds: ["u3"] },
          { id: "po3", label: "7:00 PM", voterIds: [] },
        ],
      },
    ],
    messages: [
      { id: "m1", senderId: "u1", text: "Who's bringing the grill? 🔥", time: "2h ago" },
      { id: "m2", senderId: "u2", text: "I got the charcoal covered!", time: "1h ago" },
      { id: "m3", senderId: "me", text: "Bringing drinks 🍻", time: "45m ago" },
    ],
  },
  {
    id: "e2",
    emoji: "🎮",
    title: "Game Night",
    date: "Wed, Jun 11 · 7:00 PM",
    location: "Marcus's Place",
    squadId: "s1",
    squadName: "The Usual Suspects",
    hostId: "me",
    rsvps: { ...rsvpsAllGoing(["u1", "u3"]), me: "going", u2: "maybe" },
    description: "Mario Kart tournament night! Winner gets bragging rights. Bring your best trash talk.",
    inviteCode: "GAME-4X9Z",
    tasks: [
      { id: "t4", title: "Bring snacks", assigneeId: "u2", done: false },
      { id: "t5", title: "Set up TV", assigneeId: "u1", done: true },
    ],
    costs: [],
    polls: [],
    messages: [
      { id: "m4", senderId: "u1", text: "Mario Kart or Smash first?", time: "3h ago" },
    ],
  },
  {
    id: "e3",
    emoji: "🏖️",
    title: "Beach Day",
    date: "Sun, Jun 15 · 11:00 AM",
    location: "Santa Monica Beach",
    squadId: "s2",
    squadName: "College Squad",
    hostId: "u3",
    rsvps: { ...rsvpsAllGoing(["u2", "u3"]), me: "going" },
    description: "Day at the beach! Volleyball, swimming, and sunset tacos.",
    inviteCode: "BCH-2WQY",
    tasks: [
      { id: "t6", title: "Bring sunscreen", assigneeId: "me", done: false },
      { id: "t7", title: "Pack volleyball", assigneeId: "u3", done: false },
    ],
    costs: [
      {
        id: "c3",
        description: "Parking",
        amount: 20,
        paidById: "u2",
        shares: [
          { userId: "me", amount: 6.67 },
          { userId: "u2", amount: 6.66 },
          { userId: "u3", amount: 6.67 },
        ],
      },
    ],
    polls: [],
    messages: [],
  },
  {
    id: "e4",
    emoji: "🎉",
    title: "Birthday Bash",
    date: "Fri, Jun 20 · 8:00 PM",
    location: "Skybar Rooftop",
    squadId: "s3",
    squadName: "Work Crew",
    hostId: "u4",
    rsvps: { ...rsvpsAllGoing(["u1", "u4"]), me: "going" },
    description: "Surprise birthday party for Mike! Don't tell him.",
    inviteCode: "BDAY-9KF3",
    tasks: [{ id: "t8", title: "Get the cake", assigneeId: "u4", done: false }],
    costs: [],
    polls: [],
    messages: [],
  },
];

export const ME = USERS[0];

export function getUserById(id: string): User {
  return USERS.find((u) => u.id === id) ?? USERS[0];
}

export function getSquadById(id: string): Squad | undefined {
  return SQUADS.find((s) => s.id === id);
}

export function getEventById(id: string): Event | undefined {
  return EVENTS.find((e) => e.id === id);
}

export function goingIds(event: Event): string[] {
  return Object.entries(event.rsvps)
    .filter(([, status]) => status === "going")
    .map(([id]) => id);
}

export function goingCount(event: Event): number {
  return goingIds(event).length;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseEventDate(date: string, year = 2026): Date | null {
  const m = date.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!m || !(m[1] in MONTHS)) return null;
  return new Date(year, MONTHS[m[1]], parseInt(m[2], 10));
}
