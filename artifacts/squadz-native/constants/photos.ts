export type VaultPhoto = {
  id: number;
  url: string;
  label: string;
  squad: string;
  date: string;
  emoji: string;
  color: string;
};

function seedUrl(seed: string): string {
  return `https://picsum.photos/seed/${seed}/600/600`;
}

export const PLACEHOLDER_PHOTOS: VaultPhoto[] = [
  { id: 1, url: seedUrl("squadz-bbq"), emoji: "🔥", label: "Rooftop BBQ", squad: "The Usual Suspects", date: "Jun 7", color: "#FF6B3A" },
  { id: 2, url: seedUrl("squadz-bowl"), emoji: "🎳", label: "Bowling Night", squad: "College Crew", date: "May 24", color: "#7B6EF6" },
  { id: 3, url: seedUrl("squadz-pizza"), emoji: "🍕", label: "Pizza Friday", squad: "Work Crew", date: "May 17", color: "#F5A623" },
  { id: 4, url: seedUrl("squadz-beach"), emoji: "🏖️", label: "Beach Day", squad: "Westside Fam", date: "Apr 30", color: "#4ECDC4" },
  { id: 5, url: seedUrl("squadz-game"), emoji: "🎮", label: "Game Night", squad: "The Usual Suspects", date: "Apr 19", color: "#A78BFA" },
  { id: 6, url: seedUrl("squadz-brunch"), emoji: "🍳", label: "Brunch Run", squad: "College Crew", date: "Apr 5", color: "#FB923C" },
  { id: 7, url: seedUrl("squadz-hike"), emoji: "🥾", label: "Sunrise Hike", squad: "Westside Fam", date: "Mar 22", color: "#34D399" },
  { id: 8, url: seedUrl("squadz-concert"), emoji: "🎤", label: "Concert Night", squad: "The Usual Suspects", date: "Mar 9", color: "#F472B6" },
  { id: 9, url: seedUrl("squadz-coffee"), emoji: "☕", label: "Coffee Catchup", squad: "Work Crew", date: "Feb 28", color: "#C084FC" },
];

export const FILTERS = ["All", "The Usual Suspects", "College Crew", "Work Crew", "Westside Fam"];

export function photoFilename(photo: VaultPhoto): string {
  const slug = photo.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `squadz-${slug}-${photo.id}.jpg`;
}
