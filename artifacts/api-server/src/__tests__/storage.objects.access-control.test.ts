import { describe, it, expect, vi } from "vitest";
import request from "supertest";

const canView = vi.hoisted(() => ({ value: false }));
const canViewMoment = vi.hoisted(() => ({ value: false }));
const signedDownload = vi.hoisted(() => vi.fn(() => Promise.resolve("https://signed.example/video")));

vi.mock("../storage", () => ({
  storage: {
    getPhotoByUrl: () => Promise.resolve(null),
    canUserViewPhotoByUrl: () => Promise.resolve(canView.value),
    canUserViewMessageAttachment: () => Promise.resolve(false),
    canUserViewFeedMedia: () => Promise.resolve(false),
    canUserViewMomentMedia: () => Promise.resolve(canViewMoment.value),
    canUserViewReceiptMedia: () => Promise.resolve(false),
  },
}));

vi.mock("../lib/objectStorage", () => {
  class ObjectNotFoundError extends Error {}
  class ObjectStorageService {
    async getObjectEntityFile() {
      return {} as unknown;
    }
    async downloadObject() {
      return { status: 200, headers: new Map<string, string>(), body: null };
    }
  }
  return { ObjectNotFoundError, ObjectStorageService };
});

vi.mock("../lib/logger");
vi.mock("../services/objectStorage", () => ({
  createStorageUploadUrl: vi.fn(),
  createStorageDownloadUrl: signedDownload,
}));

// `vi.mock` is hoisted above this import, so the static import below still
// resolves against the mocked modules. Importing the router here at collection
// time — instead of via `await import(...)` inside `makeApp` — keeps the
// one-time, heavy transform of the router dependency graph (real drizzle schema)
// out of the timed test/hook window, which otherwise flakes under parallel
// CPU/transform contention.
import storageRouter from "../routes/storage";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(storageRouter, user);

const OBJECT_PATH = "/api/storage/objects/uploads/photo-123";

describe("GET /api/storage/objects/*", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get(OBJECT_PATH);
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated but not authorized to view the photo", async () => {
    canView.value = false;
    const app = await makeApp({ id: "stranger" });
    const res = await request(app).get(OBJECT_PATH);
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated and authorized to view the photo", async () => {
    canView.value = true;
    const app = await makeApp({ id: "member" });
    const res = await request(app).get(OBJECT_PATH);
    expect(res.status).toBe(200);
  });

  it("returns 200 when authorized only via moment-media access", async () => {
    canView.value = false;
    canViewMoment.value = true;
    const app = await makeApp({ id: "moment-author" });
    const res = await request(app).get(OBJECT_PATH);
    expect(res.status).toBe(200);
    canViewMoment.value = false;
  });

  it("returns a signed streaming URL for an authorized Supabase object", async () => {
    canView.value = true;
    const app = await makeApp({ id: "member" });
    const res = await request(app).get(
      "/api/storage/objects/supabase/uploads/video.mp4?stream=1",
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: "https://signed.example/video",
      expiresInSeconds: 3600,
    });
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(signedDownload).toHaveBeenCalledWith("uploads/video.mp4", 3600);
  });

  it("does not issue a signed streaming URL without object access", async () => {
    canView.value = false;
    signedDownload.mockClear();
    const app = await makeApp({ id: "stranger" });
    const res = await request(app).get(
      "/api/storage/objects/supabase/uploads/video.mp4?stream=1",
    );

    expect(res.status).toBe(403);
    expect(signedDownload).not.toHaveBeenCalled();
  });

  it("rejects legacy stream resolution without downloading the object", async () => {
    canView.value = true;
    const app = await makeApp({ id: "member" });
    const res = await request(app).get(`${OBJECT_PATH}?stream=1`);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Signed streaming is unavailable for this object" });
  });
});
