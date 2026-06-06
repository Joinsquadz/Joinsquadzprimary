import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";

const canView = vi.hoisted(() => ({ value: false }));

vi.mock("../storage", () => ({
  storage: {
    canUserViewPhotoByUrl: () => Promise.resolve(canView.value),
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

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

type TestUser = { id: string; email?: string };

async function makeApp(user?: TestUser) {
  const { default: storageRouter } = await import("../routes/storage");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.isAuthenticated = function (this: Request) {
      return user != null;
    } as Request["isAuthenticated"];
    if (user) req.user = user as Express.User;
    next();
  });
  app.use("/api", storageRouter);
  return app;
}

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
});
