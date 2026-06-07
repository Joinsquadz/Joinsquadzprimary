import { describe, it, expect, vi, beforeEach } from "vitest";

const existingRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const capturedInsert = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(existingRows.value),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        capturedInsert.value = v;
        return {
          returning: () => Promise.resolve([{ id: 1, ...v }]),
        };
      },
    }),
  },
  usersTable: {},
  eventsTable: {},
  squadsTable: {},
  photosTable: { url: "url", uploaderId: "uploader_id" },
}));

const OWNER = "owner-id";

describe("storage.addPhoto eventId persistence", () => {
  beforeEach(() => {
    existingRows.value = [];
    capturedInsert.value = null;
  });

  it("stores the eventId on the new row when provided", async () => {
    const { storage } = await import("../storage");
    const result = await storage.addPhoto(OWNER, "/objects/uploads/with-event.jpg", "evt-1");
    expect(capturedInsert.value?.eventId).toBe("evt-1");
    expect(result.eventId).toBe("evt-1");
  });

  it("stores null when no eventId is provided", async () => {
    const { storage } = await import("../storage");
    const result = await storage.addPhoto(OWNER, "/objects/uploads/no-event.jpg");
    expect(capturedInsert.value?.eventId).toBeNull();
    expect(result.eventId).toBeNull();
  });
});
