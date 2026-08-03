import type { IdeaCategory, PlanIdea } from "@/types";

/**
 * Pure helpers for merging confirmed ideas into the trip itinerary's day
 * groups and ordering the pending-ideas board. Extracted from the screens so
 * the merge rules are unit-testable:
 *
 * - Confirmed ideas group by `suggestedDate` (same ISO day keys as
 *   ItineraryStop.day); null goes to the "General" bucket.
 * - Within a day group, itinerary STOPS always render first (untouched), then
 *   confirmed ideas ordered by sortOrder — reordering only ever touches ideas.
 * - Ideas whose day falls outside the trip's day keys (legacy trips without
 *   machine dates) get their own trailing day sections rather than vanishing.
 */

/** Sentinel group key for confirmed ideas without a suggested date. */
export const GENERAL_GROUP = "__general__";

export type ConfirmedIdeaGroups = {
  /** Day key → confirmed ideas sorted by sortOrder (stable by createdAt). */
  byDay: Record<string, PlanIdea[]>;
  /** Confirmed ideas with no suggestedDate ("General"), sorted by sortOrder. */
  general: PlanIdea[];
};

function bySortOrder(a: PlanIdea, b: PlanIdea): number {
  const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.createdAt.localeCompare(b.createdAt);
}

/** Groups CONFIRMED ideas by day key; everything else is ignored. */
export function groupConfirmedIdeas(ideas: PlanIdea[]): ConfirmedIdeaGroups {
  const byDay: Record<string, PlanIdea[]> = {};
  const general: PlanIdea[] = [];
  for (const idea of ideas) {
    if (idea.status !== "confirmed") continue;
    if (idea.suggestedDate) (byDay[idea.suggestedDate] ??= []).push(idea);
    else general.push(idea);
  }
  for (const key of Object.keys(byDay)) byDay[key].sort(bySortOrder);
  general.sort(bySortOrder);
  return { byDay, general };
}

/**
 * The trip's day keys extended with any idea-only days (sorted, appended after
 * the known range). Keeps stops' day sections untouched while never dropping a
 * confirmed idea on legacy trips whose date range is out of sync.
 */
export function mergedDayKeys(dayKeys: string[], groups: ConfirmedIdeaGroups): string[] {
  const known = new Set(dayKeys);
  const extras = Object.keys(groups.byDay)
    .filter((k) => !known.has(k))
    .sort();
  return [...dayKeys, ...extras];
}

export type PendingSort = "votes" | "created";

/**
 * Orders the pending-ideas board: pinned first, then by vote count (desc) or
 * newest-first, with createdAt as the stable tiebreaker.
 */
export function sortPendingIdeas(ideas: PlanIdea[], sort: PendingSort): PlanIdea[] {
  return [...ideas].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "votes" && b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Display name for an idea's submitter ("Someone" when unresolvable). */
export function ideaSubmitterName(idea: Pick<PlanIdea, "submittedBy">): string {
  const s = idea.submittedBy;
  if (!s) return "Someone";
  const name = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
  return name || "Someone";
}

export const IDEA_CATEGORY_META: Record<
  IdeaCategory,
  { label: string; icon: string; colorKey: "primary" | "green" | "gold" | "blue" | "purple" }
> = {
  activity: { label: "Activity", icon: "sparkles-outline", colorKey: "primary" },
  food: { label: "Food", icon: "restaurant-outline", colorKey: "gold" },
  lodging: { label: "Lodging", icon: "bed-outline", colorKey: "purple" },
  transport: { label: "Transport", icon: "car-outline", colorKey: "blue" },
  other: { label: "Other", icon: "ellipsis-horizontal-circle-outline", colorKey: "green" },
};

export const IDEA_CATEGORIES: IdeaCategory[] = [
  "activity",
  "food",
  "lodging",
  "transport",
  "other",
];

/**
 * Applies an optimistic vote toggle to an idea list: flips votedByMe and
 * adjusts voteCount for the given idea, returning a new array.
 */
export function applyVoteToggle(ideas: PlanIdea[], ideaId: string): PlanIdea[] {
  return ideas.map((i) =>
    i.id === ideaId
      ? { ...i, votedByMe: !i.votedByMe, voteCount: Math.max(0, i.voteCount + (i.votedByMe ? -1 : 1)) }
      : i,
  );
}

/**
 * Moves a confirmed idea up/down within its day group and returns the full new
 * id order for that group (what the reorder endpoint expects), or null when the
 * move is a no-op (already at the edge).
 */
export function moveWithinGroup(
  group: PlanIdea[],
  ideaId: string,
  direction: "up" | "down",
): string[] | null {
  const idx = group.findIndex((i) => i.id === ideaId);
  if (idx < 0) return null;
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= group.length) return null;
  const ids = group.map((i) => i.id);
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return ids;
}
