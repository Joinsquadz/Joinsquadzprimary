import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    upsertUser: vi.fn(),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByUploaderId: vi.fn().mockResolvedValue([]),
    getPhotosBySquadId: vi.fn().mockResolvedValue({ authorized: true, photos: [] }),
    getEvent: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// `vi.mock` is hoisted above these imports, so the static imports below still
// resolve against the mocked modules. Importing the router (and the mocked
// storage) here at collection time — instead of via `await import(...)` inside
// `makeApp`/`beforeEach` — keeps the one-time, heavy transform of the router
// dependency graph (real drizzle schema) out of the timed test/hook window,
// which otherwise flakes under parallel CPU/transform contention.
import vaultRouter from "../routes/vault";
import { storage } from "../storage";

type TestUser = { id: string; email?: string };

function makeApp(user?: TestUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = function (this: Request) {
      return user != null;
    } as Request["isAuthenticated"];
    if (user) req.user = user as Express.User;
    next();
  });
  app.use("/api", vaultRouter);
  return app;
}

const FREE_USER_ID = "free-user-id";
const PRO_USER_ID = "pro-user-id";

const DAY_MS = 24 * 60 * 60 * 1000;

function recentPhoto() {
  return {
    id: 1,
    eventId: "evt-1",
    uploaderId: FREE_USER_ID,
    url: "/objects/uploads/recent.jpg",
    squadId: null,
    sharedToSquad: false,
    uploadedAt: new Date(Date.now() - 5 * DAY_MS),
  };
}

function oldPhoto() {
  return {
    id: 2,
    eventId: "evt-1",
    uploaderId: FREE_USER_ID,
    url: "/objects/uploads/old.jpg",
    squadId: null,
    sharedToSquad: false,
    uploadedAt: new Date(Date.now() - 45 * DAY_MS),
  };
}

const freeUserRow = {
  id: FREE_USER_ID,
  email: "free@example.com",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
};

const proUserRow = {
  id: PRO_USER_ID,
  email: "pro@example.com",
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
};

describe("GET /api/vault/photos retention rule", () => {
  beforeEach(() => {
    vi.mocked(storage.getSubscription).mockResolvedValue(null as never);
    vi.mocked(storage.getActiveSubscriptionByCustomerId).mockResolvedValue(null as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([]);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/vault/photos");
    expect(res.status).toBe(401);
  });

  it("does NOT return 403 for a non-Pro user (endpoint is open to all authenticated users)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(freeUserRow as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([recentPhoto()] as never);

    const app = await makeApp({ id: FREE_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });

  it("non-Pro user gets recent photos with URLs and older photos locked without a URL", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(freeUserRow as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([
      recentPhoto(),
      oldPhoto(),
    ] as never);

    const app = await makeApp({ id: FREE_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(false);
    expect(res.body.photos).toHaveLength(2);

    const recent = res.body.photos.find((p: { id: number }) => p.id === 1);
    expect(recent.locked).toBe(false);
    expect(recent.url).toBe("/objects/uploads/recent.jpg");

    const old = res.body.photos.find((p: { id: number }) => p.id === 2);
    expect(old.locked).toBe(true);
    expect(old.url).toBeUndefined();
  });

  it("Pro user gets all photos with URLs and locked:false", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(proUserRow as never);
    vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([
      recentPhoto(),
      oldPhoto(),
    ] as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.photos).toHaveLength(2);

    for (const photo of res.body.photos) {
      expect(photo.locked).toBe(false);
      expect(photo.url).toBeTruthy();
    }
  });
});
