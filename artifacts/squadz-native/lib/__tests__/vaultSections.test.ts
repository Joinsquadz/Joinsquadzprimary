import { describe, it, expect } from "vitest";
import {
  buildSquadVaultSections,
  type VaultSectionEventMeta,
} from "@/lib/vaultSections";

interface TestPhoto {
  id: number;
  eventId?: string | null;
  uploadedAt: string;
}

const MOUNTAIN = "11f5f8e7-a16a-4597-b8f9-c1aadac4949e";
const BEACH = "54ba05e5-6bfc-44a1-b261-fe197301fe71";

/**
 * Mirrors the seeded "Vault Test Crew" fixture:
 *  - Mountain Trip (⛰️) — 3 photos, the NEWEST event
 *  - Beach Day (🏖️) — 2 photos, an older event
 *  - 1 event-less photo → "All other photos"
 * Photos are intentionally out of order and interleaved so ordering can only
 * pass if the grouping sorts by each event's most-recent photo.
 */
const seededPhotos: TestPhoto[] = [
  { id: 1, eventId: BEACH, uploadedAt: "2026-06-01T10:00:00.000Z" },
  { id: 2, eventId: MOUNTAIN, uploadedAt: "2026-07-05T09:00:00.000Z" },
  { id: 3, eventId: null, uploadedAt: "2026-05-20T12:00:00.000Z" },
  { id: 4, eventId: MOUNTAIN, uploadedAt: "2026-07-10T18:00:00.000Z" },
  { id: 5, eventId: BEACH, uploadedAt: "2026-06-02T14:00:00.000Z" },
  { id: 6, eventId: MOUNTAIN, uploadedAt: "2026-07-08T08:00:00.000Z" },
];

const eventsById = new Map<string, VaultSectionEventMeta>([
  [MOUNTAIN, { title: "Mountain Trip", emoji: "⛰️" }],
  [BEACH, { title: "Beach Day", emoji: "🏖️" }],
]);

describe("buildSquadVaultSections (squad vault 'By Events')", () => {
  it("produces exactly 3 sections for 2 events + event-less photos", () => {
    const sections = buildSquadVaultSections(seededPhotos, eventsById);
    expect(sections).toHaveLength(3);
  });

  it("orders the newest event first, then older events, with 'All other photos' last", () => {
    const sections = buildSquadVaultSections(seededPhotos, eventsById);
    expect(sections.map((s) => s.title)).toEqual([
      "Mountain Trip",
      "Beach Day",
      "All other photos",
    ]);
    // Event-less is always the trailing section.
    expect(sections[sections.length - 1].key).toBe("__none__");
  });

  it("reports the correct per-section counts (3 / 2 / 1)", () => {
    const sections = buildSquadVaultSections(seededPhotos, eventsById);
    expect(sections.map((s) => s.count)).toEqual([3, 2, 1]);
  });

  it("carries the right emoji + key per section", () => {
    const sections = buildSquadVaultSections(seededPhotos, eventsById);
    expect(sections[0]).toMatchObject({ key: MOUNTAIN, emoji: "⛰️" });
    expect(sections[1]).toMatchObject({ key: BEACH, emoji: "🏖️" });
    expect(sections[2]).toMatchObject({ key: "__none__", emoji: "📷" });
  });

  it("wraps each section's photos as a single grid row and totals 6 photos", () => {
    const sections = buildSquadVaultSections(seededPhotos, eventsById);
    for (const s of sections) {
      // `data` is `[items]` so the SectionList body renders one flex-wrap grid.
      expect(s.data).toHaveLength(1);
      expect(s.data[0]).toHaveLength(s.count);
    }
    const total = sections.reduce((n, s) => n + s.data[0].length, 0);
    expect(total).toBe(6);
    // Every input photo appears exactly once across all sections (no dupes/drops).
    const ids = sections.flatMap((s) => s.data[0].map((p) => p.id)).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps section ordering stable across repeated builds (toggle back and forth)", () => {
    const a = buildSquadVaultSections(seededPhotos, eventsById);
    const b = buildSquadVaultSections(seededPhotos, eventsById);
    expect(b.map((s) => s.key)).toEqual(a.map((s) => s.key));
    expect(b.map((s) => s.count)).toEqual(a.map((s) => s.count));
  });

  it("does not mutate the input photos array", () => {
    const input = [...seededPhotos];
    const snapshot = JSON.stringify(input);
    buildSquadVaultSections(input, eventsById);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).toHaveLength(6);
  });

  it("omits the 'All other photos' section when every photo has an event", () => {
    const onlyEventPhotos = seededPhotos.filter((p) => p.eventId);
    const sections = buildSquadVaultSections(onlyEventPhotos, eventsById);
    expect(sections.map((s) => s.title)).toEqual(["Mountain Trip", "Beach Day"]);
    expect(sections.some((s) => s.key === "__none__")).toBe(false);
  });

  it("returns an empty section list when there are no photos", () => {
    expect(buildSquadVaultSections([], eventsById)).toEqual([]);
  });

  it("falls back to 'Event' / 🎉 for an unknown event id", () => {
    const photos: TestPhoto[] = [
      { id: 1, eventId: "ghost-event", uploadedAt: "2026-07-01T00:00:00.000Z" },
    ];
    const [section] = buildSquadVaultSections(photos, eventsById);
    expect(section).toMatchObject({ title: "Event", emoji: "🎉", count: 1 });
  });

  it("produces a single event section with all photos when they share one event", () => {
    const photos: TestPhoto[] = [
      { id: 1, eventId: MOUNTAIN, uploadedAt: "2026-07-01T00:00:00.000Z" },
      { id: 2, eventId: MOUNTAIN, uploadedAt: "2026-07-02T00:00:00.000Z" },
    ];
    const sections = buildSquadVaultSections(photos, eventsById);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: "Mountain Trip", count: 2 });
  });
});
