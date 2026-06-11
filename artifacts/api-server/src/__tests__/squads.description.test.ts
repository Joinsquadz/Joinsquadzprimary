import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockInsertRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const captured = vi.hoisted(() => ({
  insertValues: undefined as Record<string, unknown> | undefined,
  updateValues: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.insertValues = v;
        return { returning: () => Promise.resolve(mockInsertRows.value) };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        captured.updateValues = v;
        return {
          where: () => ({
            returning: () => Promise.resolve(mockUpdateRows.value),
          }),
        };
      },
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: () => Promise.resolve(),
        select: () => ({
          from: () => ({
            where: () => Promise.resolve(mockRows.value),
            orderBy: () => Promise.resolve(mockRows.value),
          }),
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            captured.insertValues = v;
            return { returning: () => Promise.resolve(mockInsertRows.value) };
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => {
            captured.updateValues = v;
            return {
              where: () => ({
                returning: () => Promise.resolve(mockUpdateRows.value),
              }),
            };
          },
        }),
        delete: () => ({ where: () => Promise.resolve() }),
      }),
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    friendCode: "friend_code",
  },
  squadMutesTable: {
    userId: "user_id",
    squadId: "squad_id",
  },
  squadRemovalNoticesTable: {
    id: "id",
    userId: "user_id",
    squadId: "squad_id",
    seenAt: "seen_at",
  },
}));

vi.mock("../lib/logger");

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { MEMBER_ID, CREATOR_ID, makeBaseSquad } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const baseSquad = makeBaseSquad();

beforeEach(() => {
  captured.insertValues = undefined;
  captured.updateValues = undefined;
  mockRows.value = [];
  mockInsertRows.value = [];
  mockUpdateRows.value = [];
});

describe("POST /api/squads — description persistence", () => {
  it("persists and returns the description on create", async () => {
    const description = "Weekend hiking crew that meets every Saturday.";
    mockInsertRows.value = [{ ...baseSquad, description }];
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads")
      .send({ name: "Hikers", description });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe(description);
    expect(captured.insertValues?.description).toBe(description);
  });

  it("rejects a description over 280 characters with 400", async () => {
    const tooLong = "a".repeat(281);
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads")
      .send({ name: "Hikers", description: tooLong });
    expect(res.status).toBe(400);
    expect(captured.insertValues).toBeUndefined();
  });

  it("accepts a description exactly 280 characters long", async () => {
    const maxLen = "a".repeat(280);
    mockInsertRows.value = [{ ...baseSquad, description: maxLen }];
    const app = await makeApp({ id: CREATOR_ID });
    const res = await request(app)
      .post("/api/squads")
      .send({ name: "Hikers", description: maxLen });
    expect(res.status).toBe(201);
    expect(captured.insertValues?.description).toBe(maxLen);
  });
});

describe("PATCH /api/squads/:id — description edit", () => {
  it("updates the description", async () => {
    const description = "Now we also do trail running.";
    mockRows.value = [baseSquad];
    mockUpdateRows.value = [{ ...baseSquad, description }];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ description });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe(description);
    expect(captured.updateValues?.description).toBe(description);
  });

  it("clears the description when set to null", async () => {
    mockRows.value = [baseSquad];
    mockUpdateRows.value = [{ ...baseSquad, description: null }];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ description: null });
    expect(res.status).toBe(200);
    expect(res.body.description).toBeNull();
    expect(captured.updateValues).toHaveProperty("description", null);
  });

  it("rejects a description over 280 characters with 400", async () => {
    mockRows.value = [baseSquad];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ description: "a".repeat(281) });
    expect(res.status).toBe(400);
    expect(captured.updateValues).toBeUndefined();
  });
});
