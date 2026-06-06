export type User = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export type Task = {
  id: string;
  title: string;
  assigneeId: string;
  done: boolean;
};

export type Cost = {
  id: string;
  description: string;
  amount: number;
  paidById: string;
  splitWith: string[];
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
  attendeeIds: string[];
  description: string;
  inviteCode: string;
  tasks: Task[];
  costs: Cost[];
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
    attendeeIds: ["me", "u1", "u2", "u3", "u4"],
    description: "Annual rooftop BBQ! Bring your A-game grilling skills. We'll have burgers, drinks, and an amazing sunset view over the city.",
    inviteCode: "BBQ-7K2M",
    tasks: [
      { id: "t1", title: "Bring charcoal", assigneeId: "u1", done: true },
      { id: "t2", title: "Buy drinks", assigneeId: "me", done: false },
      { id: "t3", title: "Get ice", assigneeId: "u2", done: false },
    ],
    costs: [
      { id: "c1", description: "Meat & veggies", amount: 85, paidById: "u1", splitWith: ["me", "u1", "u2", "u3", "u4"] },
      { id: "c2", description: "Drinks", amount: 45, paidById: "me", splitWith: ["me", "u1", "u2", "u3", "u4"] },
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
    hostId: "u1",
    attendeeIds: ["me", "u1", "u2", "u3"],
    description: "Mario Kart tournament night! Winner gets bragging rights. Bring your best trash talk.",
    inviteCode: "GAME-4X9Z",
    tasks: [
      { id: "t4", title: "Bring snacks", assigneeId: "u2", done: false },
      { id: "t5", title: "Set up TV", assigneeId: "u1", done: true },
    ],
    costs: [],
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
    attendeeIds: ["me", "u2", "u3"],
    description: "Day at the beach! Volleyball, swimming, and sunset tacos.",
    inviteCode: "BCH-2WQY",
    tasks: [
      { id: "t6", title: "Bring sunscreen", assigneeId: "me", done: false },
      { id: "t7", title: "Pack volleyball", assigneeId: "u3", done: false },
    ],
    costs: [
      { id: "c3", description: "Parking", amount: 20, paidById: "u2", splitWith: ["me", "u2", "u3"] },
    ],
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
    attendeeIds: ["me", "u1", "u4"],
    description: "Surprise birthday party for Mike! Don't tell him.",
    inviteCode: "BDAY-9KF3",
    tasks: [{ id: "t8", title: "Get the cake", assigneeId: "u4", done: false }],
    costs: [],
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
