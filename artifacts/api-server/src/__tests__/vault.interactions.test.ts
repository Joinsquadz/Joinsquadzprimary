import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../storage", () => ({
  storage: {
    canUserViewPhotoById: vi.fn(),
    getPhotoById: vi.fn(),
    updatePhotoCaption: vi.fn(),
    toggleHeart: vi.fn(),
    getPhotoHearts: vi.fn().mockResolvedValue([]),
    getVaultComments: vi.fn().mockResolvedValue([]),
    addVaultComment: vi.fn(),
    softDeleteVaultComment: vi.fn(),
    getFriendIds: vi.fn().mockResolvedValue([]),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    getUser: vi.fn().mockResolvedValue({ id: "x", firstName: "Ann" }),
    clearPushToken: vi.fn(),
  },
}));

// Mock the db so the share route's feed-post insert is inert in unit tests.
const insertReturning = vi.fn();
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
  },
  feedPostsTable: {},
}));

vi.mock("../lib/squadEvents", () => ({ emitSquadUpdate: vi.fn() }));
vi.mock("../lib/vaultEvents", () => ({ emitVaultPhotoUpdate: vi.fn(), onVaultPhotoUpdate: vi.fn() }));
vi.mock("../lib/feedEvents", () => ({ emitFeedUpdate: vi.fn() }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/logger");

import vaultRouter from "../routes/vault";
import { storage } from "../storage";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(vaultRouter, user);

const UPLOADER = "uploader-id";
const VIEWER = "viewer-id";
const STRANGER = "stranger-id";

const photoRow = {
  id: 7,
  uploaderId: UPLOADER,
  url: "/objects/uploads/x.jpg",
  mediaType: "image",
  squadId: null,
  sharedToSquad: false,
  eventId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.getPhotoById).mockResolvedValue(photoRow as never);
  vi.mocked(storage.getPushTokensForUsers).mockResolvedValue([]);
  vi.mocked(storage.getFriendIds).mockResolvedValue([]);
  insertReturning.mockResolvedValue([{ id: 99, mediaUrl: photoRow.url }]);
});

describe("PATCH /api/vault/photos/:id/caption", () => {
  it("rejects a non-uploader (403)", async () => {
    vi.mocked(storage.updatePhotoCaption).mockResolvedValue(null as never);
    const app = await makeApp({ id: STRANGER });
    const res = await request(app).patch("/api/vault/photos/7/caption").send({ caption: "hi" });
    expect(res.status).toBe(403);
  });

  it("uploader can set a caption", async () => {
    vi.mocked(storage.updatePhotoCaption).mockResolvedValue({ ...photoRow, caption: "hi" } as never);
    const app = await makeApp({ id: UPLOADER });
    const res = await request(app).patch("/api/vault/photos/7/caption").send({ caption: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.photo.caption).toBe("hi");
  });

  it("rejects captions over 300 chars (400)", async () => {
    const app = await makeApp({ id: UPLOADER });
    const res = await request(app)
      .patch("/api/vault/photos/7/caption")
      .send({ caption: "a".repeat(301) });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/vault/photos/:id/heart", () => {
  it("blocks a user who cannot view the photo (403)", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(false as never);
    const app = await makeApp({ id: STRANGER });
    const res = await request(app).post("/api/vault/photos/7/heart");
    expect(res.status).toBe(403);
    expect(storage.toggleHeart).not.toHaveBeenCalled();
  });

  it("toggles a heart for a viewer", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true as never);
    vi.mocked(storage.toggleHeart).mockResolvedValue({ hearted: true, heartCount: 1 } as never);
    const app = await makeApp({ id: VIEWER });
    const res = await request(app).post("/api/vault/photos/7/heart");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hearted: true, heartCount: 1 });
  });
});

describe("POST /api/vault/photos/:id/comments", () => {
  it("blocks a non-viewer (403)", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(false as never);
    const app = await makeApp({ id: STRANGER });
    const res = await request(app).post("/api/vault/photos/7/comments").send({ text: "nice" });
    expect(res.status).toBe(403);
    expect(storage.addVaultComment).not.toHaveBeenCalled();
  });

  it("rejects empty text (400)", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true as never);
    const app = await makeApp({ id: VIEWER });
    const res = await request(app).post("/api/vault/photos/7/comments").send({ text: "   " });
    expect(res.status).toBe(400);
  });

  it("a viewer can add a comment", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true as never);
    vi.mocked(storage.addVaultComment).mockResolvedValue({ id: 1, text: "nice" } as never);
    const app = await makeApp({ id: VIEWER });
    const res = await request(app).post("/api/vault/photos/7/comments").send({ text: "nice" });
    expect(res.status).toBe(201);
    expect(res.body.comment.text).toBe("nice");
  });
});

describe("DELETE /api/vault/photos/:id/comments/:commentId", () => {
  it("403 when storage refuses (not author/uploader)", async () => {
    vi.mocked(storage.softDeleteVaultComment).mockResolvedValue(false as never);
    const app = await makeApp({ id: STRANGER });
    const res = await request(app).delete("/api/vault/photos/7/comments/3");
    expect(res.status).toBe(403);
  });

  it("200 when deletion is allowed", async () => {
    vi.mocked(storage.softDeleteVaultComment).mockResolvedValue(true as never);
    const app = await makeApp({ id: UPLOADER });
    const res = await request(app).delete("/api/vault/photos/7/comments/3");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /api/vault/photos/:id/share", () => {
  it("blocks a user without view access (403, no post created)", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(false as never);
    const app = await makeApp({ id: STRANGER });
    const res = await request(app).post("/api/vault/photos/7/share").send({ text: "look" });
    expect(res.status).toBe(403);
    expect(insertReturning).not.toHaveBeenCalled();
  });

  it("a viewer shares to Vibe (friends post created from the vault media)", async () => {
    vi.mocked(storage.canUserViewPhotoById).mockResolvedValue(true as never);
    const app = await makeApp({ id: VIEWER });
    const res = await request(app).post("/api/vault/photos/7/share").send({ text: "look" });
    expect(res.status).toBe(201);
    expect(res.body.post.id).toBe(99);
    expect(insertReturning).toHaveBeenCalled();
  });
});
