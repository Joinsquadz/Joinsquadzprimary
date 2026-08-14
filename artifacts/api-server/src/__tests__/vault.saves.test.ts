/**
 * "Save to my vault" — durable personal copies.
 *
 * A save is NOT a favorite. A favorite is a reference that dies with the source
 * row; a save copies the storage object and inserts a fresh photo row owned by
 * the saver, with no squad/event linkage and no FK back to the source, so it
 * survives deletion of the source photo, the event and the squad.
 *
 * Covered here:
 *  1. Saving copies the BYTES and inserts an independent, unlinked row.
 *  2. Upload provenance is recorded BEFORE the row exists (account deletion
 *     resolves media ownership from object_uploads, never from a path prefix —
 *     an unrecorded copy would outlive the saver's account purge).
 *  3. Repeat saves are idempotent — no second object, no second row.
 *  4. The copy survives source deletion (no FK, no shared object path).
 *  5. Authorization is live "can you see it right now", and hidden media and
 *     failed copies never produce a half-saved row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    upsertUser: vi.fn(),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotoById: vi.fn(),
    canUserViewPhotoById: vi.fn(),
    getSavedCopy: vi.fn(),
    getSavedSourcePhotoIds: vi.fn(),
    addSavedPhotoCopy: vi.fn(),
    deleteOwnPhoto: vi.fn(),
    recordUpload: vi.fn().mockResolvedValue(undefined),
    deleteUploadRecord: vi.fn().mockResolvedValue(undefined),
    countPhotosByUrl: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock("../lib/accountMediaCleanup", () => ({
  deleteOwnedMediaObject: vi.fn().mockResolvedValue({ deleted: true, queued: false }),
}));

vi.mock("../services/objectStorage", () => ({
  copyStorageObject: vi.fn(),
}));

vi.mock("../lib/logger");

// Static imports below vi.mock — keeps the heavy router dependency-graph
// transform out of the timed test window.
import vaultRouter from "../routes/vault";
import { storage } from "../storage";
import { copyStorageObject } from "../services/objectStorage";
import { deleteOwnedMediaObject } from "../lib/accountMediaCleanup";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(vaultRouter, user);

const SAVER_ID = "saver-user-id";
const OWNER_ID = "owner-user-id";

/**
 * The personal vault (roll-up AND saves) is the SquadZ+ entitlement — the
 * shared squad vault stays free for members. Every save test therefore runs as
 * a Pro user; `asFreeUser()` flips the subscription off to prove the server
 * gate holds without the mobile UI's help.
 */
function asProUser(): void {
  vi.mocked(storage.getUser).mockResolvedValue({
    id: SAVER_ID,
    stripeSubscriptionId: "sub_live",
  } as never);
  vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);
}

/**
 * The REAL paying subscriber today: Squadz+ is a native IAP, so RevenueCat's
 * webhook flips `is_squadz_plus` and there is no Stripe subscription row at
 * all. A Stripe-only entitlement check reads this user as free and 403s every
 * save they attempt, so the IAP shape gets its own coverage.
 */
function asIapProUser(): void {
  vi.mocked(storage.getUser).mockResolvedValue({
    id: SAVER_ID,
    isSquadzPlus: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  } as never);
  vi.mocked(storage.getSubscription).mockResolvedValue(null as never);
  vi.mocked(storage.getActiveSubscriptionByCustomerId).mockResolvedValue(null as never);
}

function asFreeUser(): void {
  vi.mocked(storage.getUser).mockResolvedValue({ id: SAVER_ID } as never);
  vi.mocked(storage.getSubscription).mockResolvedValue(null as never);
  vi.mocked(storage.getActiveSubscriptionByCustomerId).mockResolvedValue(null as never);
}

/** A squad-vault photo uploaded by someone else that the saver can see. */
function sourcePhoto(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    uploaderId: OWNER_ID,
    url: "/objects/supabase/uploads/original.jpg",
    eventId: "evt-1",
    squadId: "squad-1",
    sharedToSquad: true,
    mediaType: "image",
    caption: "Sunset",
    status: "visible",
    savedFromPhotoId: null,
    uploadedAt: new Date(),
    ...overrides,
  };
}

describe("POST /api/vault/saves — durable personal copies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asProUser();
    vi.mocked(storage.getPhotoById).mockResolvedValue(sourcePhoto() as never);
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true);
    vi.mocked(storage.getSavedCopy).mockResolvedValue(null);
    vi.mocked(copyStorageObject).mockResolvedValue("/objects/supabase/uploads/copy.jpg");
    vi.mocked(storage.addSavedPhotoCopy).mockImplementation(
      async (userId, source, url) =>
        ({
          id: 99,
          uploaderId: userId,
          url,
          eventId: null,
          squadId: null,
          sharedToSquad: false,
          savedFromPhotoId: (source as { id: number }).id,
        }) as never,
    );
  });

  it("copies the storage object so the save owns independent bytes", async () => {
    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(201);
    expect(copyStorageObject).toHaveBeenCalledWith("/objects/supabase/uploads/original.jpg");
    // The new row must point at the COPY, never at the source's object path —
    // sharing the path would break the save the instant the source is deleted.
    expect(res.body.photo.url).toBe("/objects/supabase/uploads/copy.jpg");
    expect(res.body.photo.url).not.toBe("/objects/supabase/uploads/original.jpg");
  });

  it("creates a row owned by the saver with no squad or event linkage", async () => {
    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(201);
    expect(res.body.photo.uploaderId).toBe(SAVER_ID);
    // No eventId/squadId: the copy is personal, so it neither leaks back into
    // the source squad roll-up nor dies when that squad is torn down.
    expect(res.body.photo.eventId).toBeNull();
    expect(res.body.photo.squadId).toBeNull();
    expect(res.body.photo.sharedToSquad).toBe(false);
    expect(res.body.photo.savedFromPhotoId).toBe(42);
  });

  it("records upload provenance BEFORE inserting the row", async () => {
    await request(makeApp({ id: SAVER_ID })).post("/api/vault/saves").send({ photoId: 42 });

    expect(storage.recordUpload).toHaveBeenCalledWith(
      SAVER_ID,
      "/objects/supabase/uploads/copy.jpg",
    );
    // Ordering matters: account deletion resolves media ownership from
    // object_uploads, so a row that exists before its provenance can orphan
    // bytes that survive the saver's purge forever.
    const provenanceOrder = vi.mocked(storage.recordUpload).mock.invocationCallOrder[0];
    const insertOrder = vi.mocked(storage.addSavedPhotoCopy).mock.invocationCallOrder[0];
    expect(provenanceOrder).toBeLessThan(insertOrder);
  });

  it("is idempotent — a repeat save reuses the existing copy", async () => {
    vi.mocked(storage.getSavedCopy).mockResolvedValue({ id: 99, uploaderId: SAVER_ID } as never);

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(200);
    expect(res.body.alreadySaved).toBe(true);
    // No second object, no second row — re-tapping save must not burn storage.
    expect(copyStorageObject).not.toHaveBeenCalled();
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
  });

  it("refuses public-URL media instead of duplicating its row", async () => {
    vi.mocked(storage.getPhotoById).mockResolvedValue(
      sourcePhoto({ url: "https://cdn.example.com/pic.jpg" }) as never,
    );

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    // photos.url is globally UNIQUE, so a copy can never reuse the source URL —
    // that insert would blow up with a constraint violation (a 500 to the user)
    // after already claiming provenance. A public asset has no private object
    // to copy, so the only correct answer is an explicit refusal.
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("UNSUPPORTED_MEDIA");
    expect(copyStorageObject).not.toHaveBeenCalled();
    expect(storage.recordUpload).not.toHaveBeenCalled();
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
  });

  it("releases the copied object when a concurrent save wins the race", async () => {
    // Both requests pass the "already saved?" probe; the unique
    // (uploader_id, saved_from_photo_id) index picks a winner. The loser has
    // already copied bytes and recorded provenance, so it must give both back
    // or every racing double-tap leaks a private object forever.
    vi.mocked(storage.addSavedPhotoCopy).mockResolvedValue(null);
    vi.mocked(storage.getSavedCopy)
      .mockResolvedValueOnce(null)                            // pre-insert probe
      .mockResolvedValueOnce({ id: 77, url: "/objects/supabase/uploads/winner.jpg" } as never);

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    // The user still gets a saved photo — the winner's — not an error.
    expect(res.status).toBe(200);
    expect(res.body.alreadySaved).toBe(true);
    expect(res.body.photo.id).toBe(77);
    expect(storage.deleteUploadRecord).toHaveBeenCalledWith(
      SAVER_ID,
      "/objects/supabase/uploads/copy.jpg",
    );
    expect(deleteOwnedMediaObject).toHaveBeenCalledWith(
      SAVER_ID,
      "/objects/supabase/uploads/copy.jpg",
    );
  });

  it("rejects saving media the user cannot currently see", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(false);

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(403);
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
    expect(copyStorageObject).not.toHaveBeenCalled();
  });

  it("rejects saving hidden (moderated) media", async () => {
    vi.mocked(storage.getPhotoById).mockResolvedValue(
      sourcePhoto({ status: "hidden" }) as never,
    );

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(403);
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
  });

  it("does not create a row when the object copy fails", async () => {
    vi.mocked(copyStorageObject).mockResolvedValue(null);

    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(503);
    // A row whose bytes were never copied would render as a broken tile.
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const res = await request(makeApp()).post("/api/vault/saves").send({ photoId: 42 });
    expect(res.status).toBe(401);
  });

  it("rejects a malformed photoId", async () => {
    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: "not-a-number" });
    expect(res.status).toBe(400);
  });
});

describe("saved copies survive deletion of their source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asProUser();
  });

  it("keeps returning the copy after the source photo is gone", async () => {
    // The copy carries savedFromPhotoId as a BARE integer (no FK), so deleting
    // photo 42 cannot cascade the copy away. getSavedCopy still resolves it.
    vi.mocked(storage.getPhotoById).mockResolvedValue(null);
    vi.mocked(storage.getSavedCopy).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: "/objects/supabase/uploads/copy.jpg",
      savedFromPhotoId: 42,
    } as never);
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: "/objects/supabase/uploads/copy.jpg",
    } as never);

    // Removing by source id still finds the orphaned-but-alive personal copy.
    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(storage.deleteOwnPhoto).toHaveBeenCalledWith(99, SAVER_ID);
  });
});

describe("GET /api/vault/saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asProUser();
  });

  it("returns the source ids the user has already saved", async () => {
    vi.mocked(storage.getSavedSourcePhotoIds).mockResolvedValue([1, 2, 3]);

    const res = await request(makeApp({ id: SAVER_ID })).get("/api/vault/saves");

    expect(res.status).toBe(200);
    expect(res.body.sourceIds).toEqual([1, 2, 3]);
    expect(storage.getSavedSourcePhotoIds).toHaveBeenCalledWith(SAVER_ID);
  });

  it("requires authentication", async () => {
    const res = await request(makeApp()).get("/api/vault/saves");
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/vault/saves/:photoId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asProUser();
  });

  it("is a no-op when nothing was saved from that source", async () => {
    vi.mocked(storage.getSavedCopy).mockResolvedValue(null);

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(false);
    expect(storage.deleteOwnPhoto).not.toHaveBeenCalled();
  });

  it("deletes only the caller's own copy", async () => {
    vi.mocked(storage.getSavedCopy).mockResolvedValue({ id: 99 } as never);
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue(null as never);

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    // deleteOwnPhoto is scoped by uploaderId, so a guessed copy id belonging to
    // someone else can never be removed through this route — and when it
    // matches nothing, no bytes and no provenance are touched either.
    expect(storage.deleteOwnPhoto).toHaveBeenCalledWith(99, SAVER_ID);
    expect(res.body.removed).toBe(false);
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
    expect(storage.deleteUploadRecord).not.toHaveBeenCalled();
  });

  it("rejects a malformed source id", async () => {
    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/abc");
    expect(res.status).toBe(400);
  });
});

/**
 * A save allocates THREE things — a copied storage object, an object_uploads
 * provenance row and a photo row. Un-saving has to give all three back, or
 * every save/un-save cycle leaks a private object forever and leaves a
 * provenance row pointing at bytes nothing references (which then misdirects
 * account-deletion cleanup at an object that is already unreferenced).
 */
describe("un-saving releases the copied bytes and their provenance", () => {
  const COPY_URL = "/objects/supabase/uploads/copy.jpg";

  beforeEach(() => {
    vi.clearAllMocks();
    asProUser();
    vi.mocked(storage.getSavedCopy).mockResolvedValue({ id: 99, url: COPY_URL } as never);
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: COPY_URL,
    } as never);
    vi.mocked(storage.countPhotosByUrl).mockResolvedValue(0);
  });

  it("deletes the copied object and its provenance row", async () => {
    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(storage.deleteUploadRecord).toHaveBeenCalledWith(SAVER_ID, COPY_URL);
    expect(deleteOwnedMediaObject).toHaveBeenCalledWith(SAVER_ID, COPY_URL);
  });

  it("keeps the bytes when another row still points at the same object", async () => {
    // Never delete an object something still renders — a re-save racing this
    // delete would otherwise be left with a broken tile.
    vi.mocked(storage.countPhotosByUrl).mockResolvedValue(1);

    await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
    expect(storage.deleteUploadRecord).not.toHaveBeenCalled();
  });

  it("leaves public URLs alone — there is no owned object to release", async () => {
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: "https://cdn.example.com/pic.jpg",
    } as never);

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
  });

  it("still reports success when the byte delete is only queued", async () => {
    // The row is already gone and the user's intent is honoured; a storage
    // outage degrades into the retry queue, not a failed request.
    vi.mocked(deleteOwnedMediaObject).mockResolvedValue({ deleted: false, queued: true });

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
  });

  it("a repeated un-save does not try to delete the bytes twice", async () => {
    vi.mocked(storage.getSavedCopy).mockResolvedValue(null);

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.body.removed).toBe(false);
    expect(deleteOwnedMediaObject).not.toHaveBeenCalled();
  });
});

/**
 * The mobile UI gates saving behind SquadZ+, but a UI gate is bypassable by
 * calling the API directly. The entitlement has to hold server-side on every
 * save endpoint, or a free user could bank copies and keep them until upgrade.
 */
describe("the personal vault entitlement is enforced server-side", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asFreeUser();
    vi.mocked(storage.getPhotoById).mockResolvedValue(sourcePhoto() as never);
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true);
    vi.mocked(storage.getSavedCopy).mockResolvedValue(null);
  });

  it("refuses a free user's save without copying bytes or inserting a row", async () => {
    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PRO_REQUIRED");
    expect(copyStorageObject).not.toHaveBeenCalled();
    expect(storage.recordUpload).not.toHaveBeenCalled();
    expect(storage.addSavedPhotoCopy).not.toHaveBeenCalled();
  });

  it("returns an empty save list for a free user", async () => {
    const res = await request(makeApp({ id: SAVER_ID })).get("/api/vault/saves");

    // Not a 403: the grid just renders nothing as saved, and the save action
    // itself is what surfaces the upgrade prompt.
    expect(res.status).toBe(200);
    expect(res.body.sourceIds).toEqual([]);
    expect(res.body.requiresPro).toBe(true);
    expect(storage.getSavedSourcePhotoIds).not.toHaveBeenCalled();
  });

  it("still lets a free user REMOVE a copy they already hold", async () => {
    // Downgrading must not trap bytes the user can no longer manage.
    vi.mocked(storage.getSavedCopy).mockResolvedValue({ id: 99, url: "/objects/supabase/uploads/c.jpg" } as never);
    vi.mocked(storage.deleteOwnPhoto).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: "/objects/supabase/uploads/c.jpg",
    } as never);
    vi.mocked(storage.countPhotosByUrl).mockResolvedValue(0);

    const res = await request(makeApp({ id: SAVER_ID })).delete("/api/vault/saves/42");

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(deleteOwnedMediaObject).toHaveBeenCalled();
  });
});

/**
 * ...and the mirror image of the gate: an entitlement check that only knows how
 * to read Stripe locks out the ONLY kind of subscriber the app actually has.
 * Mobile IAP is the sole purchase surface, so these cases are the common path,
 * not an edge case.
 */
describe("a native-IAP subscriber is entitled to the personal vault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asIapProUser();
    vi.mocked(storage.getPhotoById).mockResolvedValue(sourcePhoto() as never);
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true);
    vi.mocked(storage.getSavedCopy).mockResolvedValue(null);
    vi.mocked(copyStorageObject).mockResolvedValue("/objects/supabase/uploads/copy.jpg");
    vi.mocked(storage.addSavedPhotoCopy).mockResolvedValue({
      id: 99,
      uploaderId: SAVER_ID,
      url: "/objects/supabase/uploads/copy.jpg",
      savedFromPhotoId: 42,
    } as never);
  });

  it("saves for a user whose Squadz+ comes from RevenueCat, not Stripe", async () => {
    const res = await request(makeApp({ id: SAVER_ID }))
      .post("/api/vault/saves")
      .send({ photoId: 42 });

    expect(res.status).toBe(201);
    expect(res.body.code).toBeUndefined();
    expect(copyStorageObject).toHaveBeenCalled();
    expect(storage.addSavedPhotoCopy).toHaveBeenCalled();
  });

  it("lists their saved source ids instead of an empty requiresPro stub", async () => {
    vi.mocked(storage.getSavedSourcePhotoIds).mockResolvedValue([42, 7] as never);

    const res = await request(makeApp({ id: SAVER_ID })).get("/api/vault/saves");

    expect(res.status).toBe(200);
    expect(res.body.sourceIds).toEqual([42, 7]);
    expect(res.body.requiresPro).toBeUndefined();
  });
});
