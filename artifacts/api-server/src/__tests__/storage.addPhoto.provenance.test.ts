import { describe, it, expect, vi, beforeEach } from "vitest";

const existingRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const insertedRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// `vi.mock` is hoisted above imports, so the static import below still resolves
// against the mocked `@workspace/db`. Importing the module here (at collection
// time) instead of inside each `it()` keeps the one-time, heavy transform of the
// storage dependency graph out of the 5000ms per-test timeout, which otherwise
// flakes under parallel CPU/transform contention.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(existingRows.value),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(insertedRows.value),
      }),
    }),
  },
  usersTable: {},
  eventsTable: {},
  squadsTable: {},
  photosTable: { url: "url", uploaderId: "uploader_id" },
}));

import { storage, PhotoUrlConflictError } from "../storage";

const OWNER = "owner-id";
const ATTACKER = "attacker-id";
const URL = "/objects/uploads/photo-abc";

describe("storage.addPhoto URL provenance", () => {
  beforeEach(() => {
    existingRows.value = [];
    insertedRows.value = [];
  });

  it("rejects claiming a URL already uploaded by another user", async () => {
    existingRows.value = [{ id: 1, url: URL, uploaderId: OWNER, sharedToSquad: false }];
    await expect(storage.addPhoto(ATTACKER, URL)).rejects.toBeInstanceOf(
      PhotoUrlConflictError,
    );
  });

  it("is idempotent for the original uploader (returns existing row)", async () => {
    const row = { id: 1, url: URL, uploaderId: OWNER, sharedToSquad: false };
    existingRows.value = [row];
    const result = await storage.addPhoto(OWNER, URL);
    expect(result).toEqual(row);
  });

  it("inserts a new row when the URL has not been recorded", async () => {
    const inserted = { id: 2, url: URL, uploaderId: OWNER, sharedToSquad: false };
    existingRows.value = [];
    insertedRows.value = [inserted];
    const result = await storage.addPhoto(OWNER, URL);
    expect(result).toEqual(inserted);
  });
});
