/**
 * Original vault-media deletion.
 *
 * The DELETE endpoint is deliberately separate from squad unsharing: only the
 * original uploader may remove a photo row. It never releases underlying bytes
 * or provenance because other content types can reference the same object.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../storage", () => ({
  storage: {
    deleteOwnPhoto: vi.fn(),
    countPhotosByUrl: vi.fn().mockResolvedValue(0),
    deleteUploadRecord: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/accountMediaCleanup", () => ({
  deleteOwnedMediaObject: vi.fn().mockResolvedValue({ deleted: true, queued: false }),
}));

vi.mock("../lib/logger");

import vaultRouter from "../routes/vault";
import { storage } from "../storage";
import { deleteOwnedMediaObject } from "../lib/accountMediaCleanup";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const OWNER_ID = "owner-user-id";
const OTHER_ID = "other-user-id";
const PRIVATE_URL = "/objects/supabase/uploads/original.jpg";

const makeApp = (user?: TestUser) => makeTestApp(vaultRouter, user);

function removedPhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    uploaderId: OWNER_ID,
    url: PRIVATE_URL,
    squadId: null,
    eventId: null,
    ...overrides,
  };
}

describe("DELETE /api/vault/photos/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue(removedPhoto() as never);
    vi.mocked(storage.countPhotosByUrl).mockResolvedValue(0);
  });

  it("requires authentication", async () => {
    const res = await request(makeApp()).delete("/api/vault/photos/42");

    expect(res.status).toBe(401);
    expect(storage.deleteOwnPhoto).not.toHaveBeenCalled();
  });

  it("rejects malformed photo ids", async () => {
    const res = await request(makeApp({ id: OWNER_ID })).delete("/api/vault/photos/not-a-number");

    expect(res.status).toBe(400);
    expect(storage.deleteOwnPhoto).not.toHaveBeenCalled();
  });

  it("only deletes a row owned by the authenticated uploader", async () => {
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue(null);

    const res = await request(makeApp({ id: OTHER_ID })).delete("/api/vault/photos/42");

    expect(res.status).toBe(403);
    expect(storage.deleteOwnPhoto).toHaveBeenCalledWith(42, OTHER_ID);
    expect(storage.deleteUploadRecord).not.toHaveBeenCalled();
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
  });

  it("removes only the uploader-owned row and never releases private bytes", async () => {
    const res = await request(makeApp({ id: OWNER_ID })).delete("/api/vault/photos/42");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, removed: true });
    expect(storage.deleteOwnPhoto).toHaveBeenCalledWith(42, OWNER_ID);
    expect(storage.countPhotosByUrl).not.toHaveBeenCalled();
    expect(storage.deleteUploadRecord).not.toHaveBeenCalled();
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
  });

  it("does not try to delete public URL media", async () => {
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue(
      removedPhoto({ url: "https://cdn.example.com/photo.jpg" }) as never,
    );

    const res = await request(makeApp({ id: OWNER_ID })).delete("/api/vault/photos/42");

    expect(res.status).toBe(200);
    expect(storage.countPhotosByUrl).not.toHaveBeenCalled();
    expect(storage.deleteUploadRecord).not.toHaveBeenCalled();
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
  });
});