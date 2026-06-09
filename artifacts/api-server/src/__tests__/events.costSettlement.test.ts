import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  updateRows: [] as unknown[],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbState.selectRows),
        orderBy: () => Promise.resolve(dbState.selectRows),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(dbState.updateRows) }) }),
    }),
  },
  eventsTable: { id: "id", hostId: "host_id", rsvps: "rsvps", costs: "costs" },
  usersTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUsers: vi.fn(),
  getSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const HOST = "host-id";
const ALICE = "alice-id";
const BOB = "bob-id";

const eventWith = (costs: unknown[]) => ({
  id: "evt-1",
  title: "BBQ",
  emoji: "🔥",
  hostId: HOST,
  date: "TBD",
  rsvps: { [ALICE]: "going", [BOB]: "going" },
  costs,
});

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.updateRows = [];
  storageMock.getUser.mockResolvedValue({ id: HOST, firstName: "Hank", lastName: null, email: "h@x.io" });
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/events/:id/costs — owe-push to debtors", () => {
  it("pushes each debtor (not the payer) with the Payments pref", async () => {
    dbState.selectRows = [eventWith([])];
    dbState.updateRows = [eventWith([])];
    storageMock.getUser.mockResolvedValue({ id: HOST, firstName: "Hank", lastName: null, email: null });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[x]"]);

    const app = await makeApp({ id: HOST });
    await request(app)
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 30,
        paidById: HOST,
        shares: [
          { userId: HOST, amount: 10 },
          { userId: ALICE, amount: 10 },
          { userId: BOB, amount: 10 },
        ],
      })
      .expect(200);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledTimes(2));
    const recipients = storageMock.getPushTokensForUsers.mock.calls.map((c) => (c[0] as string[])[0]);
    expect(recipients).toContain(ALICE);
    expect(recipients).toContain(BOB);
    expect(recipients).not.toContain(HOST);
    const [, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyPayments?: boolean }];
    expect(opts.requireNotifyPayments).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.body).toContain("Hank");
    expect(payload.body).toContain("$10.00");
    expect(payload.data.eventId).toBe("evt-1");
  });

  it("rejects a payer who is not an event participant", async () => {
    dbState.selectRows = [eventWith([])];
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 10,
        paidById: "stranger",
        shares: [{ userId: HOST, amount: 10 }],
      });
    expect(res.status).toBe(400);
  });

  it("rejects a share referencing a non-participant", async () => {
    dbState.selectRows = [eventWith([])];
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 20,
        paidById: HOST,
        shares: [
          { userId: HOST, amount: 10 },
          { userId: "stranger", amount: 10 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate share users in one cost", async () => {
    dbState.selectRows = [eventWith([])];
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 20,
        paidById: HOST,
        shares: [
          { userId: ALICE, amount: 10 },
          { userId: ALICE, amount: 10 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("does not push debtors with a zero share", async () => {
    dbState.selectRows = [eventWith([])];
    dbState.updateRows = [eventWith([])];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[x]"]);

    const app = await makeApp({ id: HOST });
    await request(app)
      .post("/api/events/evt-1/costs")
      .send({
        description: "Pizza",
        amount: 20,
        paidById: HOST,
        shares: [
          { userId: HOST, amount: 10 },
          { userId: ALICE, amount: 10 },
          { userId: BOB, amount: 0 },
        ],
      })
      .expect(200);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1));
    const recipients = storageMock.getPushTokensForUsers.mock.calls.map((c) => (c[0] as string[])[0]);
    expect(recipients).toEqual([ALICE]);
  });
});

describe("POST /api/events/:id/costs/:costId/mark-paid", () => {
  const cost = {
    id: "c1",
    description: "Pizza",
    amount: 30,
    paidById: HOST,
    shares: [
      { userId: HOST, amount: 10 },
      { userId: ALICE, amount: 10 },
      { userId: BOB, amount: 10 },
    ],
  };

  it("lets a debtor mark their own share paid and pushes the creditor", async () => {
    dbState.selectRows = [eventWith([cost])];
    dbState.updateRows = [eventWith([cost])];
    storageMock.getUser.mockResolvedValue({ id: ALICE, firstName: "Alice", lastName: null, email: null });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[host]"]);

    const app = await makeApp({ id: ALICE });
    const res = await request(app).post("/api/events/evt-1/costs/c1/mark-paid").send({ paid: true });
    expect(res.status).toBe(200);

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyPayments?: boolean }];
    expect(recipientIds).toEqual([HOST]);
    expect(opts.requireNotifyPayments).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("Alice");
  });

  it("rejects the payer marking their own (nonexistent) debt", async () => {
    dbState.selectRows = [eventWith([cost])];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/costs/c1/mark-paid").send({ paid: true });
    expect(res.status).toBe(400);
  });

  it("blocks re-marking once the creditor has confirmed", async () => {
    const confirmed = {
      ...cost,
      shares: cost.shares.map((s) =>
        s.userId === ALICE ? { ...s, paidAt: "2026-01-01T00:00:00.000Z", confirmedAt: "2026-01-02T00:00:00.000Z" } : s,
      ),
    };
    dbState.selectRows = [eventWith([confirmed])];
    const app = await makeApp({ id: ALICE });
    const res = await request(app).post("/api/events/evt-1/costs/c1/mark-paid").send({ paid: false });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/events/:id/costs/:costId/shares/:shareUserId/confirm", () => {
  const paidCost = {
    id: "c1",
    description: "Pizza",
    amount: 30,
    paidById: HOST,
    shares: [
      { userId: HOST, amount: 10 },
      { userId: ALICE, amount: 10, paidAt: "2026-01-01T00:00:00.000Z", confirmedAt: null },
    ],
  };

  it("lets the payer confirm a paid share", async () => {
    dbState.selectRows = [eventWith([paidCost])];
    dbState.updateRows = [eventWith([paidCost])];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/costs/c1/shares/alice-id/confirm").send({ confirmed: true });
    expect(res.status).toBe(200);
  });

  it("rejects a non-payer trying to confirm", async () => {
    dbState.selectRows = [eventWith([paidCost])];
    const app = await makeApp({ id: ALICE });
    const res = await request(app).post("/api/events/evt-1/costs/c1/shares/alice-id/confirm").send({ confirmed: true });
    expect(res.status).toBe(403);
  });

  it("rejects confirming a share that was never marked paid", async () => {
    const unpaid = {
      ...paidCost,
      shares: [
        { userId: HOST, amount: 10 },
        { userId: ALICE, amount: 10 },
      ],
    };
    dbState.selectRows = [eventWith([unpaid])];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/costs/c1/shares/alice-id/confirm").send({ confirmed: true });
    expect(res.status).toBe(409);
  });
});

describe("GET /api/events/:id/payment-handles", () => {
  it("returns a member-authorized handle map", async () => {
    const cost = {
      id: "c1",
      description: "Pizza",
      amount: 20,
      paidById: HOST,
      shares: [
        { userId: HOST, amount: 10 },
        { userId: ALICE, amount: 10 },
      ],
    };
    dbState.selectRows = [eventWith([cost])];
    storageMock.getUsers.mockResolvedValue([
      { id: HOST, venmoHandle: "hank", cashappHandle: null, zelleHandle: null },
      { id: ALICE, venmoHandle: null, cashappHandle: "alicecash", zelleHandle: "alice@x.io" },
    ]);

    const app = await makeApp({ id: ALICE });
    const res = await request(app).get("/api/events/evt-1/payment-handles");
    expect(res.status).toBe(200);
    expect(res.body.handles[HOST]).toEqual({ venmo: "hank", cashapp: null, zelle: null });
    expect(res.body.handles[ALICE]).toEqual({ venmo: null, cashapp: "alicecash", zelle: "alice@x.io" });
  });

  it("denies a non-member", async () => {
    dbState.selectRows = [eventWith([])];
    const app = await makeApp({ id: "stranger" });
    const res = await request(app).get("/api/events/evt-1/payment-handles");
    expect(res.status).toBe(403);
  });
});
