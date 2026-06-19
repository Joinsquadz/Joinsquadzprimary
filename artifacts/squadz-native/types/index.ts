export type User = {
  id: string;
  name: string;
  initials: string;
  color: string;
  profileImageUrl?: string | null;
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
  /** ISO timestamp set when the debtor marks this share as paid (null/absent = unpaid). */
  paidAt?: string | null;
  /** ISO timestamp set when the payer confirms the payment was received. */
  confirmedAt?: string | null;
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

export type StopCategory = "food" | "activity" | "lodging" | "travel" | "other";

/** A single ordered stop in a trip's itinerary (freeform location text, no maps). */
export type ItineraryStop = {
  id: string;
  /** ISO calendar date the stop belongs to, e.g. "2026-07-18". */
  day: string;
  /** Freeform display start time, e.g. "9:00 AM" or "". */
  time: string;
  /** Freeform display end time; when set, the stop renders a time range. */
  endTime: string;
  title: string;
  placeName: string;
  address: string;
  note: string;
  category: StopCategory;
  status: "confirmed" | "proposed";
  cost: number | null;
  paidById: string | null;
  /** Optional squad member responsible for this stop. */
  assigneeId: string | null;
  createdBy: string;
  votes: string[];
  sortOrder: number;
};

/** A shared packing-list item for a trip. */
export type PackingItem = {
  id: string;
  label: string;
  done: boolean;
  assigneeId: string | null;
  createdBy: string;
};

export type EventType = "event" | "trip";

export type Event = {
  id: string;
  emoji: string;
  title: string;
  date: string;
  /** Discriminates a one-off event from a multi-day trip. */
  type: EventType;
  /** Machine-readable ISO datetime when a concrete time is set; null/undefined = TBD. */
  eventAt?: string | null;
  /** Trip date range (ISO). For trips, startAt mirrors eventAt; endAt is the last day. */
  startAt?: string | null;
  endAt?: string | null;
  /** Trips: all-day (times set per stop) vs a single concrete time. */
  allDay?: boolean;
  /** Cover gradient style key for trip cards/headers. */
  coverStyle?: string;
  location: string;
  squadId: string;
  squadName: string;
  hostId: string;
  /** User ids granted "help manage" rights (edit details/color/itinerary). */
  coAdminIds?: string[];
  rsvps: Record<string, RsvpStatus>;
  /** Friends invited directly (by user id), in addition to squad members. */
  invitedUserIds: string[];
  description: string;
  inviteCode: string;
  tasks: Task[];
  costs: Cost[];
  polls: Poll[];
  messages: Message[];
  /** Ordered itinerary stops (trips only; empty for plain events). */
  itinerary: ItineraryStop[];
  /** Shared packing checklist (trips only; empty for plain events). */
  packing: PackingItem[];
  cancelled?: boolean;
  budget?: number;
  isPublic?: boolean;
  version: number;
};

export type Squad = {
  id: string;
  name: string;
  description?: string | null;
  emoji: string;
  memberIds: string[];
  color: string;
  isPublic?: boolean;
  creatorId?: string | null;
  /** User ids granted "help manage" rights (settings, members/invites). */
  coAdminIds?: string[];
  inviteCode?: string | null;
  membersCanInvite?: boolean;
  muted?: boolean;
  version?: number;
};
