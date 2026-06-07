import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Hoisted mutable state so vi.mock factory can close over it.
const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// In-memory store that simulates squad_mutes table rows. Seeded per-test and
// cleared by the mock delete handler when the route calls
// db.delete(squadMutesTable).where(...), giving us real data-state assertions.
const mutesStore = vi.hoisted(() => ({
  rows: [] as Array<{ squadId: string; userId: string }>,
}));

// Keep a stable reference so we can do identity checks inside the mock.
const squadMutesRef = vi.hoisted(() => ({
  userId: "user_id",
  squadId: "squad_id",
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
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: () => {
        if (table === squadMutesRef) {
          mutesStore.rows = [];
        }
        return Promise.resolve();
      },
    }),
    // The DELETE route wraps its two deletes in a transaction. Provide a mock
    // that runs the callback with a tx object sharing the same delete logic.
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        delete: (table: unknown) => ({
          where: () => {
            if (table === squadMutesRef) {
              mutesStore.rows = [];
            }
            return Promise.resolve();
          },
        }),
      };
      return fn(tx);
    },
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    transaction: async (cb: (tx: {
      delete: (table: unknown) => { where: () => Promise<void> };
    }) => Promise<void>) => {
      const tx = {
        delete: (table: unknown) => ({
          where: () => {
            if (table === squadMutesRef) {
              // Simulate the DB delete inside the transaction: drain mutes rows
              // for the deleted squad, matching real behaviour.
              mutesStore.rows = [];
            }
            return Promise.resolve();
          },
        }),
      };
      await cb(tx);
    },
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
  squadMutesTable: squadMutesRef,
  squadRemovalNoticesTable: {
    id: "id",
    userId: "user_id",
    squadId: "squad_id",
    seenAt: "seen_at",
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn(),
    filterUnmutedForSquad: vi.fn().mockResolvedValue([]),
  },
}));

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";
import { CREATOR_ID, MEMBER_ID, SECOND_MEMBER_ID, makeBaseSquad } from "./helpers/fixtures";

const makeApp = (user?: { id: string }) => makeTestApp(squadsRouter, user);

describe("DELETE /api/squads/:id — orphan squad_mutes cleanup", () => {
  beforeEach(() => {
    // Seed two mute rows for the squad that will be deleted.
    mutesStore.rows = [
      { squadId: "squad-1", userId: MEMBER_ID },
      { squadId: "squad-1", userId: SECOND_MEMBER_ID },
    ];
  });

  it("removes all squad_mutes rows for the deleted squad", async () => {
    mockRows.value = [makeBaseSquad()];
    const app = await makeApp({ id: CREATOR_ID });

    const res = await request(app).delete("/api/squads/squad-1");

    expect(res.status).toBe(204);
    const surviving = mutesStore.rows.filter((r) => r.squadId === "squad-1");
    expect(surviving).toHaveLength(0);
  });

  it("leaves squad_mutes untouched when the squad is not found (404)", async () => {
    mockRows.value = [];
    const app = await makeApp({ id: MEMBER_ID });

    const res = await request(app).delete("/api/squads/nonexistent");

    expect(res.status).toBe(404);
    // Mutes seeded in beforeEach must still be present — no cleanup should
    // have run because the squad was never found.
    expect(mutesStore.rows).toHaveLength(2);
  });

  it("leaves squad_mutes untouched when the caller is not a member (403)", async () => {
    // Squad exists but MEMBER_ID is not in its memberIds.
    mockRows.value = [makeBaseSquad({ memberIds: [SECOND_MEMBER_ID] })];
    const app = await makeApp({ id: MEMBER_ID });

    const res = await request(app).delete("/api/squads/squad-1");

    expect(res.status).toBe(403);
    expect(mutesStore.rows).toHaveLength(2);
  });
});
