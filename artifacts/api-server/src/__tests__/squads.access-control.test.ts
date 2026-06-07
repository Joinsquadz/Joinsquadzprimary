import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
      }),
    }),
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
  },
}));

vi.mock("../lib/logger");

// `vi.mock` is hoisted above this import, so the static import below still
// resolves against the mocked modules. Importing the router here at collection
// time — instead of via `await import(...)` inside `makeApp` — keeps the
// one-time, heavy transform of the router dependency graph (real drizzle schema)
// out of the timed test/hook window, which otherwise flakes under parallel
// CPU/transform contention.
import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const MEMBER_ID = "member-user-id";
const STRANGER_ID = "stranger-user-id";
const SECOND_MEMBER_ID = "second-member-id";

const baseSquad = {
  id: "squad-1",
  name: "Test Squad",
  emoji: "👥",
  color: "#FF5C3A",
  memberIds: [MEMBER_ID, SECOND_MEMBER_ID],
  createdAt: new Date().toISOString(),
};

describe("GET /api/squads/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/squads/squad-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not a member)", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).get("/api/squads/squad-1");
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as a member", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/squads/squad-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-1");
  });

  it("returns 200 when authenticated as a second member", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: SECOND_MEMBER_ID });
    const res = await request(app).get("/api/squads/squad-1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("squad-1");
  });

  it("returns 404 when squad does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).get("/api/squads/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/squads/:id", () => {
  beforeEach(() => {
    mockUpdateRows.value = [{ ...baseSquad, name: "Updated Squad" }];
  });

  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Updated Squad" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not a member)", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Updated Squad" });
    expect(res.status).toBe(403);
  });

  it("returns 200 when authenticated as a member", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Updated Squad" });
    expect(res.status).toBe(200);
  });

  it("returns 404 when squad does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Updated Squad" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/squads/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).delete("/api/squads/squad-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated as a stranger (not a member)", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: STRANGER_ID });
    const res = await request(app).delete("/api/squads/squad-1");
    expect(res.status).toBe(403);
  });

  it("returns 204 when authenticated as a member", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).delete("/api/squads/squad-1");
    expect(res.status).toBe(204);
  });

  it("returns 404 when squad does not exist", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app).delete("/api/squads/nonexistent");
    expect(res.status).toBe(404);
  });
});
