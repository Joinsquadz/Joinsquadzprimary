import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const mockSquadRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSquadRows.value),
        orderBy: () => Promise.resolve(mockSquadRows.value),
      }),
    }),
  },
  squadsTable: { id: "id", memberIds: "member_ids" },
  usersTable: { id: "id", firstName: "first_name", lastName: "last_name" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", seenAt: "seen_at" },
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  setPhotosSharedToSquad: vi.fn(),
  unsharePhotoFromSquad: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_ID = "free-member";
const SQUAD_ID = "squad-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockSquadRows.value = [{ id: SQUAD_ID, name: "Weekend Crew", memberIds: [USER_ID] }];
  storageMock.getUser.mockResolvedValue({ id: USER_ID, isSquadzPlus: false });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
});

describe("squad vault roll-up entitlement", () => {
  it("rejects a free member with valid owned photo ids before any share occurs", async () => {
    const response = await request(makeTestApp(squadsRouter, { id: USER_ID }))
      .post(`/api/squads/${SQUAD_ID}/vault`)
      .send({ photoIds: [101, 102] });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "PRO_REQUIRED", requiresPro: true });
    // Ownership is validated inside the storage method; it must never be reached
    // for a free member, even when the supplied ids would otherwise be valid.
    expect(storageMock.setPhotosSharedToSquad).not.toHaveBeenCalled();
  });

  it("still lets a free member remove their own media from the squad vault", async () => {
    storageMock.unsharePhotoFromSquad.mockResolvedValue({ id: 101 });

    const response = await request(makeTestApp(squadsRouter, { id: USER_ID }))
      .delete(`/api/squads/${SQUAD_ID}/vault/101`);

    expect(response.status).toBe(204);
    expect(storageMock.unsharePhotoFromSquad).toHaveBeenCalledWith(101, USER_ID, SQUAD_ID);
  });
});