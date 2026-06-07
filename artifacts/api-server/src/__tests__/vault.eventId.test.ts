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
    addPhoto: vi.fn(),
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

const PRO_USER_ID = "pro-user-id";

const proUserRow = {
  id: PRO_USER_ID,
  email: "pro@example.com",
  stripeCustomerId: "cus_123",
  stripeSubscriptionId: "sub_123",
};

describe("POST /api/vault/photos eventId handling", () => {
  beforeEach(() => {
    vi.mocked(storage.getUser).mockResolvedValue(proUserRow as never);
    vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);
  });

  it("passes the eventId through to storage and returns the saved row with it", async () => {
    vi.mocked(storage.addPhoto).mockResolvedValue({
      id: 10,
      eventId: "evt-1",
      uploaderId: PRO_USER_ID,
      url: "/objects/uploads/with-event.jpg",
      squadId: null,
      sharedToSquad: false,
      uploadedAt: new Date(),
    } as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app)
      .post("/api/vault/photos")
      .send({ url: "/objects/uploads/with-event.jpg", eventId: "evt-1" });

    expect(res.status).toBe(201);
    expect(storage.addPhoto).toHaveBeenCalledWith(
      PRO_USER_ID,
      "/objects/uploads/with-event.jpg",
      "evt-1",
    );
    expect(res.body.photo.eventId).toBe("evt-1");
  });

  it("passes undefined eventId through to storage when omitted", async () => {
    vi.mocked(storage.addPhoto).mockResolvedValue({
      id: 11,
      eventId: null,
      uploaderId: PRO_USER_ID,
      url: "/objects/uploads/no-event.jpg",
      squadId: null,
      sharedToSquad: false,
      uploadedAt: new Date(),
    } as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app)
      .post("/api/vault/photos")
      .send({ url: "/objects/uploads/no-event.jpg" });

    expect(res.status).toBe(201);
    expect(storage.addPhoto).toHaveBeenCalledWith(
      PRO_USER_ID,
      "/objects/uploads/no-event.jpg",
      undefined,
    );
    expect(res.body.photo.eventId).toBeNull();
  });
});

describe("GET /api/vault/photos exposes eventId", () => {
  beforeEach(() => {
    vi.mocked(storage.getUser).mockResolvedValue(proUserRow as never);
    vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);
  });

  it("returns eventId on each photo so clients can resolve the event/squad", async () => {
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([
      {
        id: 20,
        eventId: "evt-42",
        uploaderId: PRO_USER_ID,
        url: "/objects/uploads/a.jpg",
        squadId: null,
        sharedToSquad: false,
        uploadedAt: new Date(),
      },
      {
        id: 21,
        eventId: null,
        uploaderId: PRO_USER_ID,
        url: "/objects/uploads/b.jpg",
        squadId: null,
        sharedToSquad: false,
        uploadedAt: new Date(),
      },
    ] as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    const withEvent = res.body.photos.find((p: { id: number }) => p.id === 20);
    const withoutEvent = res.body.photos.find((p: { id: number }) => p.id === 21);
    expect(withEvent.eventId).toBe("evt-42");
    expect(withoutEvent.eventId).toBeNull();
  });
});
