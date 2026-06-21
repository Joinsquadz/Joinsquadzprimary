export const T = {
  bg: "#0A0A0F", surface: "#12121A", surfaceUp: "#1A1A26", surfaceHigh: "#22222F",
  border: "#2A2A3A", borderLight: "#333348", accent: "#FF5C3A", accentDim: "#FF5C3A30",
  accentGlow: "#FF5C3A18", gold: "#FFB547", goldDim: "#FFB54720", green: "#2ECC8A",
  greenDim: "#2ECC8A20", blue: "#4A9EFF", blueDim: "#4A9EFF20", purple: "#A855F7",
  purpleDim: "#A855F720", pink: "#FF6BB5", pinkDim: "#FF6BB520",
  text: "#F0EFF8", textSub: "#9898B0", textDim: "#55556A", white: "#FFFFFF",
};

export const avatarPalette = [T.accent, T.gold, T.green, T.blue, T.purple, T.pink, "#FF8C42", "#42D4FF"];
export const getAvatarColor = (str: string) => avatarPalette[(str || "?").charCodeAt(0) % avatarPalette.length];

export const font = `'DM Sans Variable', 'DM Sans', system-ui, sans-serif`;
export const fontMono = `'DM Mono', monospace`;

export const SQUADS = [
  { id: 1, name: "The Usual Suspects", emoji: "🔥", members: 7, color: T.accent, lastEvent: "Rooftop BBQ", streak: 12 },
  { id: 2, name: "Work Crew", emoji: "💼", members: 5, color: T.blue, lastEvent: "Escape Room", streak: 4 },
  { id: 3, name: "College Fam", emoji: "🎓", members: 12, color: T.purple, lastEvent: "Lake House Wknd", streak: 8 },
  { id: 4, name: "Neighbors", emoji: "🏡", members: 6, color: T.green, lastEvent: "Block BBQ", streak: 3 },
];

export const MEMBERS = [
  { name: "Marcus", role: "Host", status: "going" },
  { name: "Jordan", role: "You", status: "going" },
  { name: "Kira", role: "Member", status: "going" },
  { name: "Alex", role: "Member", status: "maybe" },
  { name: "Tasha", role: "Member", status: "going" },
  { name: "Rico", role: "Member", status: "cant" },
  { name: "Priya", role: "Member", status: "going" },
];

export const EVENT = {
  title: "Rooftop BBQ 🔥", date: "Sat, Jun 7 · 5:00 PM",
  location: "Marcus's Place, 142 Oak St", squad: "The Usual Suspects",
  cover: T.accent, rsvp: { going: 5, maybe: 1, cant: 1 },
};

export const FOOD_ITEMS = [
  { id: 1, item: "Burgers & buns", emoji: "🍔", who: "Marcus", claimed: true },
  { id: 2, item: "Veggie skewers", emoji: "🥦", who: "Kira", claimed: true },
  { id: 3, item: "Potato salad", emoji: "🥗", who: null, claimed: false },
  { id: 4, item: "Watermelon", emoji: "🍉", who: "Jordan", claimed: true },
  { id: 5, item: "Drinks & seltzers", emoji: "🥤", who: null, claimed: false },
  { id: 6, item: "Chips & dip", emoji: "🍟", who: "Alex", claimed: true },
];

export const EXPENSES = [
  { id: 1, label: "Drinks (Jordan)", amt: 38, who: "Jordan" },
  { id: 2, label: "Decorations (Kira)", amt: 24, who: "Kira" },
  { id: 3, label: "Ice (TBD)", amt: 12, who: null },
];

export const ACTIVITY_FEED = [
  { who: "Marcus", action: "updated location", detail: "his rooftop", time: "2m ago", emoji: "📍" },
  { who: "Kira", action: "claimed", detail: "Veggie skewers", time: "14m ago", emoji: "🍽️" },
  { who: "Alex", action: "voted", detail: "5 PM start time", time: "1h ago", emoji: "🗳️" },
  { who: "Tasha", action: "RSVP'd Going", detail: "", time: "2h ago", emoji: "✅" },
  { who: "Rico", action: "can't make it", detail: "next time", time: "3h ago", emoji: "😔" },
  { who: "Jordan", action: "created event", detail: "Rooftop BBQ", time: "Yesterday", emoji: "🎉" },
];

export const SUGGESTIONS = [
  { title: "Game Night", emoji: "🎮", why: "You haven't hung out in 2 weeks!", color: T.purple, type: "Indoor" },
  { title: "Brunch Run", emoji: "☀️", why: "3 of you loved the last one", color: T.gold, type: "Food" },
  { title: "Hiking Day", emoji: "🥾", why: "Weather looks perfect this weekend", color: T.green, type: "Outdoor" },
  { title: "Movie Night", emoji: "🎬", why: "New releases are dropping", color: T.blue, type: "Indoor" },
];

export const EVENT_PHOTOS = [
  { em: "🌅", uploadedAt: new Date("2026-04-02") },
  { em: "🔥", uploadedAt: new Date("2026-04-02") },
  { em: "🥩", uploadedAt: new Date("2026-04-03") },
  { em: "🍺", uploadedAt: new Date("2026-06-01") },
  { em: "😄", uploadedAt: new Date("2026-06-02") },
  { em: "🌃", uploadedAt: new Date("2026-06-05") },
];

export const USER_EVENTS = [
  { id: "ue1", title: "Lake House Weekend", date: "2026-03-22" },
  { id: "ue2", title: "Game Night", date: "2026-05-10" },
];

export const MESSAGES = [
  { type: "event", name: "Rooftop BBQ", squad: "The Usual Suspects", emoji: "🔥", preview: "Marcus: Rooftop is ready!", time: "2m", unread: 3 },
  { type: "dm", who: "Marcus", online: true, preview: "watermelon would be fire", time: "15m", unread: 1 },
  { type: "dm", who: "Kira", online: false, preview: "I claimed veggie skewers!", time: "1h", unread: 0 },
  { type: "event", name: "Escape Room", squad: "Work Crew", emoji: "🔐", preview: "Tasha: Who's driving?", time: "3h", unread: 2 },
  { type: "dm", who: "Alex", online: true, preview: "Can't wait for Saturday", time: "5h", unread: 0 },
  { type: "event", name: "Lake House Wknd", squad: "College Fam", emoji: "🏠", preview: "Jordan: I got the coolers", time: "1d", unread: 0 },
];
