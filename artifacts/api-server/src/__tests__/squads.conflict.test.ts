import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const captured = vi.hoisted(() => ({
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
  },
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    version: "version",
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
import { MEMBER_ID, makeBaseSquad } from "./helpers/fixtures";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const baseSquad = makeBaseSquad({ version: 3 });

beforeEach(() => {
  captured.updateValues = undefined;
  mockRows.value = [];
  mockUpdateRows.value = [];
});

describe("PATCH /api/squads/:id — version conflict", () => {
  it("increments the version on a successful update", async () => {
    mockRows.value = [baseSquad];
    mockUpdateRows.value = [{ ...baseSquad, name: "Renamed", version: 4 }];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Renamed", version: 3 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
    // version is bumped via SQL expression, so it is present in the SET clause.
    expect(captured.updateValues).toHaveProperty("version");
    // the client-supplied version is stripped from the persisted fields.
    expect(captured.updateValues?.version).not.toBe(3);
  });

  it("returns 409 with conflict:true when the version does not match", async () => {
    mockRows.value = [baseSquad];
    // Stale version → the guarded UPDATE matches no rows.
    mockUpdateRows.value = [];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Renamed", version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
    expect(typeof res.body.error).toBe("string");
  });

  it("still updates (no version guard) when no version is supplied", async () => {
    mockRows.value = [baseSquad];
    mockUpdateRows.value = [{ ...baseSquad, name: "Renamed", version: 4 }];
    const app = await makeApp({ id: MEMBER_ID });
    const res = await request(app)
      .patch("/api/squads/squad-1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });
});
