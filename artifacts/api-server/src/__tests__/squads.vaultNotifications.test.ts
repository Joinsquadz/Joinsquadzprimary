import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
        orderBy: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
  },
  squadsTable: { id: "id", memberIds: "member_ids" },
  usersTable: { id: "id", firstName: "first_name", lastName: "last_name" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", seenAt: "seen_at" },
}));

const storageMock = vi.hoisted(() => ({
  setPhotosSharedToSquad: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  getUser: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import squadsRouter from "../routes/squads";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const SHARER = "sharer-id";
const MEMBER_A = "member-a";
const MEMBER_B = "member-b";

const SQUAD = {
  id: "squad-1",
  name: "Weekend Crew",
  memberIds: [SHARER, MEMBER_A, MEMBER_B],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows.value = [SQUAD];
  storageMock.setPhotosSharedToSquad.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
  storageMock.getUser.mockResolvedValue({
    id: SHARER,
    firstName: "Sam",
    lastName: null,
    email: "sam@x.io",
    isSquadzPlus: true,
  });
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/squads/:id/vault — vault-share push", () => {
  it("notifies other members (not the sharer) with the Friend Activity pref and deep-links to the vault", async () => {
    const app = makeApp({ id: SHARER });
    const res = await request(app).post("/api/squads/squad-1/vault").send({ photoIds: [1, 2] });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1));

    const [recipientIds] = storageMock.filterUnmutedForSquad.mock.calls[0] as [string[], string];
    expect(recipientIds).not.toContain(SHARER);
    expect(recipientIds).toEqual(expect.arrayContaining([MEMBER_A, MEMBER_B]));

    const [, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(opts.requireNotifyFriendActivity).toBe(true);

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.data.screen).toBe("vault");
    expect(payload.data.squadId).toBe("squad-1");
    expect(payload.body).toContain("Sam");
  });

  it("does NOT send when nothing was actually shared", async () => {
    storageMock.setPhotosSharedToSquad.mockResolvedValue([]);

    const app = makeApp({ id: SHARER });
    await request(app).post("/api/squads/squad-1/vault").send({ photoIds: [99] });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("does NOT send when every other member has muted the squad", async () => {
    storageMock.filterUnmutedForSquad.mockResolvedValue([]);

    const app = makeApp({ id: SHARER });
    await request(app).post("/api/squads/squad-1/vault").send({ photoIds: [1] });

    await new Promise((r) => setTimeout(r, 50));
    expect(storageMock.getPushTokensForUsers).not.toHaveBeenCalled();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("does NOT send when recipients have the Friend Activity pref off (no tokens)", async () => {
    storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = makeApp({ id: SHARER });
    await request(app).post("/api/squads/squad-1/vault").send({ photoIds: [1] });

    await new Promise((r) => setTimeout(r, 50));
    const [, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(opts.requireNotifyFriendActivity).toBe(true);
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});
