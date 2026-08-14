import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

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
    getUserFavoritePhotoIds: vi.fn().mockResolvedValue(new Set()),
    getVaultInteractionStats: vi.fn().mockResolvedValue({
      heartCounts: new Map(),
      heartedIds: new Set(),
      commentCounts: new Map(),
    }),
  },
}));

vi.mock("../lib/logger");

// `vi.mock` is hoisted above these imports, so the static imports below still
// resolve against the mocked modules. Importing the router (and the mocked
// storage) here at collection time — instead of via `await import(...)` inside
// `makeApp`/`beforeEach` — keeps the one-time, heavy transform of the router
// dependency graph (real drizzle schema) out of the timed test/hook window,
// which otherwise flakes under parallel CPU/transform contention.
import vaultRouter from "../routes/vault";
import { storage } from "../storage";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(vaultRouter, user);

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

describe("GET /api/vault/photos subscription gate", () => {
  beforeEach(() => {
    vi.mocked(storage.getSubscription).mockResolvedValue(null as never);
    vi.mocked(storage.getActiveSubscriptionByCustomerId).mockResolvedValue(null as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([]);
    vi.mocked(storage.getPhotosBySquadId).mockResolvedValue({ authorized: true, photos: [] } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/vault/photos");
    expect(res.status).toBe(401);
  });

  it("free user hitting the personal roll-up gets the Squadz+ entrance gate (empty + requiresPro)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(freeUserRow as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([recentPhoto()] as never);

    const app = await makeApp({ id: FREE_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(false);
    expect(res.body.requiresPro).toBe(true);
    expect(res.body.photos).toHaveLength(0);
    // The gate short-circuits before any personal photo fetch.
    expect(storage.getPhotosByUploaderId).not.toHaveBeenCalled();
  });

  it("free squad member can read a squad-scoped vault (open to members, no gate)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(freeUserRow as never);
    vi.mocked(storage.getPhotosBySquadId).mockResolvedValue({
      authorized: true,
      photos: [recentPhoto()],
    } as never);

    const app = await makeApp({ id: FREE_USER_ID });
    const res = await request(app).get("/api/vault/photos?squadId=sq-1");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(false);
    expect(res.body.requiresPro).toBeUndefined();
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.photos[0].url).toBe("/objects/uploads/recent.jpg");
    expect(res.body.photos[0].locked).toBeUndefined();
  });

  it("IAP subscriber (is_squadz_plus, no Stripe row) gets their personal roll-up", async () => {
    // Squadz+ is sold as a native IAP: RevenueCat's webhook sets is_squadz_plus
    // and there is NO Stripe subscription. This route once resolved entitlement
    // with a local Stripe-only copy of the check, so every paying mobile
    // subscriber saw an empty vault behind an upgrade gate they'd already paid.
    vi.mocked(storage.getUser).mockResolvedValue({
      id: PRO_USER_ID,
      email: "iap@example.com",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      isSquadzPlus: true,
    } as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([recentPhoto()] as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.requiresPro).toBeUndefined();
    expect(res.body.photos).toHaveLength(1);
    // The flag alone is sufficient — no Stripe lookup should be needed at all.
    expect(storage.getSubscription).not.toHaveBeenCalled();
    expect(storage.getActiveSubscriptionByCustomerId).not.toHaveBeenCalled();
  });

  it("Pro user gets their personal roll-up with URLs and no lock field", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(proUserRow as never);
    vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);
    vi.mocked(storage.getPhotosByUploaderId).mockResolvedValue([recentPhoto()] as never);

    const app = await makeApp({ id: PRO_USER_ID });
    const res = await request(app).get("/api/vault/photos");

    expect(res.status).toBe(200);
    expect(res.body.isPro).toBe(true);
    expect(res.body.requiresPro).toBeUndefined();
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.photos[0].url).toBe("/objects/uploads/recent.jpg");
    expect(res.body.photos[0].locked).toBeUndefined();
  });
});
