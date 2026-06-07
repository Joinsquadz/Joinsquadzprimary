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
  budget?: number;
  isPublic?: boolean;
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
  inviteCode?: string | null;
  membersCanInvite?: boolean;
  muted?: boolean;
};
