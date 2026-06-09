import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenURL = vi.hoisted(() => vi.fn(async (_url: string) => true));
const mockCanOpenURL = vi.hoisted(() => vi.fn(async (_url: string) => true));
const platformState = vi.hoisted(() => ({ OS: "ios" as "ios" | "android" | "web" }));

vi.mock("react-native", () => ({
  Linking: { openURL: mockOpenURL, canOpenURL: mockCanOpenURL },
  get Platform() {
    return { OS: platformState.OS };
  },
}));

import {
  computeOwed,
  computeOwedToMe,
  payWithVenmoHandle,
  payWithCashAppHandle,
  zelleInstructions,
} from "../settle";
import type { Cost } from "@/types";

const ME = "me";
const ALICE = "alice";
const BOB = "bob";

const cost = (over: Partial<Cost> & { id: string }): Cost =>
  ({
    description: "Pizza",
    amount: 30,
    paidById: ALICE,
    shares: [],
    ...over,
  }) as Cost;

beforeEach(() => {
  vi.clearAllMocks();
  platformState.OS = "ios";
});

describe("computeOwed", () => {
  it("groups what I owe by the requester and skips costs I paid", () => {
    const costs: Cost[] = [
      cost({
        id: "c1",
        description: "Pizza",
        paidById: ALICE,
        shares: [
          { userId: ME, amount: 10 },
          { userId: ALICE, amount: 10 },
        ],
      }),
      cost({
        id: "c2",
        description: "Beer",
        paidById: ALICE,
        shares: [{ userId: ME, amount: 5 }],
      }),
      // I paid this one — should not appear in what I owe.
      cost({
        id: "c3",
        description: "Cab",
        paidById: ME,
        shares: [{ userId: BOB, amount: 8 }],
      }),
    ];
    const groups = computeOwed(costs, ME);
    expect(groups).toHaveLength(1);
    expect(groups[0].userId).toBe(ALICE);
    expect(groups[0].total).toBe(15);
    expect(groups[0].outstanding).toBe(15);
    expect(groups[0].shares.map((s) => s.costId).sort()).toEqual(["c1", "c2"]);
  });

  it("reflects paid/confirmed status and excludes confirmed from outstanding", () => {
    const costs: Cost[] = [
      cost({
        id: "c1",
        paidById: ALICE,
        shares: [{ userId: ME, amount: 10, paidAt: "2026-01-01T00:00:00Z" }],
      }),
      cost({
        id: "c2",
        description: "Beer",
        paidById: ALICE,
        shares: [{ userId: ME, amount: 6, paidAt: "2026-01-01T00:00:00Z", confirmedAt: "2026-01-02T00:00:00Z" }],
      }),
    ];
    const [group] = computeOwed(costs, ME);
    expect(group.total).toBe(16);
    expect(group.outstanding).toBe(10);
    const byId = Object.fromEntries(group.shares.map((s) => [s.costId, s.status]));
    expect(byId.c1).toBe("paid");
    expect(byId.c2).toBe("confirmed");
  });

  it("ignores zero-amount shares", () => {
    const costs: Cost[] = [
      cost({ id: "c1", paidById: ALICE, shares: [{ userId: ME, amount: 0 }] }),
    ];
    expect(computeOwed(costs, ME)).toHaveLength(0);
  });
});

describe("computeOwedToMe", () => {
  it("groups what others owe me by debtor, only for costs I paid", () => {
    const costs: Cost[] = [
      cost({
        id: "c1",
        paidById: ME,
        shares: [
          { userId: ME, amount: 10 },
          { userId: ALICE, amount: 10 },
          { userId: BOB, amount: 10 },
        ],
      }),
      // Alice paid — irrelevant for owed-to-me.
      cost({ id: "c2", paidById: ALICE, shares: [{ userId: ME, amount: 5 }] }),
    ];
    const groups = computeOwedToMe(costs, ME);
    expect(groups.map((g) => g.userId).sort()).toEqual([ALICE, BOB]);
    expect(groups.every((g) => g.total === 10)).toBe(true);
  });
});

describe("payWithVenmoHandle", () => {
  it("opens the venmo app deep link when installed (strips leading @)", async () => {
    mockCanOpenURL.mockResolvedValue(true);
    await payWithVenmoHandle("@alice", 12.5, "Pizza");
    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    const url = mockOpenURL.mock.calls[0][0] as string;
    expect(url).toContain("venmo://paycharge");
    expect(url).toContain("recipients=alice");
    expect(url).toContain("amount=12.50");
  });

  it("falls back to the web profile when the app cannot open", async () => {
    mockCanOpenURL.mockResolvedValue(false);
    await payWithVenmoHandle("alice", 12.5, "Pizza");
    const url = mockOpenURL.mock.calls[0][0] as string;
    expect(url).toContain("account.venmo.com/u/alice");
  });

  it("uses the web URL directly on web", async () => {
    platformState.OS = "web";
    await payWithVenmoHandle("alice", 5, "x");
    expect(mockCanOpenURL).not.toHaveBeenCalled();
    expect(mockOpenURL.mock.calls[0][0]).toContain("account.venmo.com");
  });
});

describe("payWithCashAppHandle", () => {
  it("opens a cashtag URL with the amount (strips leading $)", async () => {
    await payWithCashAppHandle("$alicecash", 8);
    const url = mockOpenURL.mock.calls[0][0] as string;
    expect(url).toBe("https://cash.app/$alicecash/8");
  });
});

describe("zelleInstructions", () => {
  it("returns the handle unchanged (no deep link possible)", () => {
    expect(zelleInstructions("alice@example.com")).toBe("alice@example.com");
  });
});
