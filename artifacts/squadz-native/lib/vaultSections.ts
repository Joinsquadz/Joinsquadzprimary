/**
 * Pure grouping logic for the squad Photo Vault "By Events" view.
 *
 * The squad vault has two view modes:
 *  - "Grid": a flat list of every rolled-up photo (no grouping).
 *  - "By Events": photos grouped into one section per event, ordered so the
 *    NEWEST event (by its most-recent photo) comes first, with a trailing
 *    "All other photos" section for event-less photos.
 *
 * This is extracted from `app/vault.tsx` so the grouping/ordering/counting can
 * be unit-tested deterministically (the screen itself is gated behind
 * authenticated network calls that can't run headless in this environment).
 */

/** Minimal shape the grouping needs from a squad vault photo. */
export interface VaultSectionPhoto {
  eventId?: string | null;
  uploadedAt: string;
}

/** Minimal shape the grouping needs from an event lookup. */
export interface VaultSectionEventMeta {
  title?: string | null;
  emoji?: string | null;
}

/** A rendered "By Events" section. `data` is `[items]` so a SectionList renders
 * the whole event's photos as a single grid row (matching the screen). */
export interface VaultSection<T> {
  key: string;
  title: string;
  emoji: string;
  count: number;
  latest: number;
  data: T[][];
}

const EVENTLESS_SECTION_KEY = "__none__";

/**
 * Groups squad vault photos into "By Events" sections.
 *
 * - One section per distinct `eventId`, titled/emoji'd from `eventsById`
 *   (falling back to "Event" / 🎉 when the event is unknown).
 * - Sections are sorted newest-event-first, where an event's recency is the
 *   most recent `uploadedAt` among its photos.
 * - Event-less photos are collected into a single trailing "All other photos"
 *   section (📷), only when at least one such photo exists.
 *
 * The input arrays are never mutated.
 */
export function buildSquadVaultSections<T extends VaultSectionPhoto>(
  photos: readonly T[],
  eventsById: ReadonlyMap<string, VaultSectionEventMeta>,
): VaultSection<T>[] {
  const groups = new Map<string, T[]>();
  const noEvent: T[] = [];
  for (const p of photos) {
    if (p.eventId) {
      const arr = groups.get(p.eventId) ?? [];
      arr.push(p);
      groups.set(p.eventId, arr);
    } else {
      noEvent.push(p);
    }
  }
  const latest = (items: readonly T[]) =>
    items.reduce((max, p) => Math.max(max, new Date(p.uploadedAt).getTime() || 0), 0);
  const sections: VaultSection<T>[] = Array.from(groups.entries())
    .map(([evId, items]) => {
      const ev = eventsById.get(evId);
      return {
        key: evId,
        title: ev?.title ?? "Event",
        emoji: ev?.emoji ?? "🎉",
        count: items.length,
        latest: latest(items),
        data: [items],
      };
    })
    .sort((a, b) => b.latest - a.latest);
  if (noEvent.length > 0) {
    sections.push({
      key: EVENTLESS_SECTION_KEY,
      title: "All other photos",
      emoji: "📷",
      count: noEvent.length,
      latest: -1,
      data: [noEvent],
    });
  }
  return sections;
}
