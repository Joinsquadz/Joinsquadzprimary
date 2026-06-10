export type {
  User,
  RsvpStatus,
  Task,
  CostShare,
  Cost,
  PollOption,
  Poll,
  Message,
  Event,
  Squad,
} from "@/types";

export { goingIds, goingCount, parseEventDate } from "@/lib/eventUtils";

const USER_COLORS = [
  "#FF5C3A", "#A855F7", "#2ECC8A", "#FFB547", "#4A9EFF",
  "#E91E8C", "#00BCD4", "#FF9800", "#8BC34A", "#9C27B0",
];

export type MockUser = {
  id: string;
  name: string;
  initials: string;
  color: string;
  profileImageUrl?: string | null;
};

// Neutral placeholder for the brief window before the real authenticated user
// (apiUser) loads. NEVER give this a real-looking name/initials — it is shown as
// `currentUser` while apiUser is momentarily null, and a fake name leaks into the
// UI as if it were the signed-in person.
export const ME: MockUser = { id: "me", name: "You", initials: "", color: USER_COLORS[0] };
