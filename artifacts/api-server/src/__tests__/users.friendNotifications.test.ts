import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({ targetRows: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbState.targetRows),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
    }),
  },
  usersTable: { id: "id" },
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  squadsTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getPushTokensForUsers: vi.fn(),
  getUser: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import usersRouter from "../routes/users";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(usersRouter, user);

const ME = "me-id";
const FRIEND = "friend-id";

beforeEach(() => {
  vi.clearAllMocks();
  dbState.targetRows = [{ id: FRIEND }];
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.getUser.mockResolvedValue({ id: ME, firstName: "Mia", lastName: null, email: "mia@x.io" });
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/users/friends — friend-add push", () => {
  it("notifies the new friend with the Friend Activity pref", async () => {
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[f]"]);

    const app = await makeApp({ id: ME });
    await request(app).post("/api/users/friends").send({ friendId: FRIEND });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(recipientIds).toEqual([FRIEND]);
    expect(opts.requireNotifyFriendActivity).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.body).toContain("Mia");
    expect(payload.data.screen).toBe("friends");
  });

  it("does NOT send when the new friend has no token / disabled the pref", async () => {
    storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = await makeApp({ id: ME });
    await request(app).post("/api/users/friends").send({ friendId: FRIEND });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});
