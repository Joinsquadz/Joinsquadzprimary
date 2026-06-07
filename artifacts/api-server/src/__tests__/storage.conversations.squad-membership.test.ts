import { describe, it, expect, vi, beforeEach } from "vitest";

// Each awaited query shifts the next result off this queue, in call order. We
// only mock the `db` client (real drizzle schema/columns are used), and we spy
// the helper methods that would otherwise issue their own queries, so the query
// order inside the functions under test stays deterministic:
//   listConversationsForUser -> [squads, participantRows]
//   getTotalUnreadCount      -> [squads, participantRows]
const queue = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => {
  const builder: Record<string, unknown> = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(queue.value.shift() ?? []).then(resolve, reject),
  };
  return { db: { select: () => builder } };
});

import { storage } from "../storage";

const ME = "me-id";
const CURRENT_SQUAD = "squad-current";
const REMOVED_SQUAD = "squad-removed";

beforeEach(() => {
  queue.value = [];
  vi.restoreAllMocks();
  // These helpers issue their own queries; stub them so the queue above only
  // has to satisfy the two top-level selects in each function.
  vi.spyOn(storage, "getOrCreateSquadConversation").mockResolvedValue(null);
});

describe("listConversationsForUser — squad membership enforcement", () => {
  it("excludes squad conversations the user has been removed from", async () => {
    vi.spyOn(
      storage as unknown as { countUnreadInConversation: () => Promise<number> },
      "countUnreadInConversation",
    ).mockResolvedValue(0);

    // squads select: only the squad the user is CURRENTLY in.
    const squads = [{ id: CURRENT_SQUAD, name: "Current", emoji: "🔥", color: "#FF5C3A" }];
    // participant rows: a stale row for the removed squad still exists.
    const rows = [
      {
        convo: {
          id: "conv-current",
          type: "squad",
          squadId: CURRENT_SQUAD,
          lastMessageAt: new Date(),
          lastMessagePreview: "hi",
          lastMessageSenderId: "u1",
        },
        lastReadAt: null,
      },
      {
        convo: {
          id: "conv-stale",
          type: "squad",
          squadId: REMOVED_SQUAD,
          lastMessageAt: new Date(),
          lastMessagePreview: "secret group chatter",
          lastMessageSenderId: "u2",
        },
        lastReadAt: null,
      },
    ];
    queue.value = [squads, rows];

    const result = await storage.listConversationsForUser(ME);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("conv-current");
    expect(result.some((c) => c.id === "conv-stale")).toBe(false);
    expect(result.some((c) => c.squadId === REMOVED_SQUAD)).toBe(false);
  });
});

describe("getTotalUnreadCount — squad membership enforcement", () => {
  it("does not count unread messages from squads the user was removed from", async () => {
    const countSpy = vi
      .spyOn(
        storage as unknown as { countUnreadInConversation: (id: string) => Promise<number> },
        "countUnreadInConversation",
      )
      .mockResolvedValue(5);

    const squads = [{ id: CURRENT_SQUAD }];
    const rows = [
      { conversationId: "conv-current", lastReadAt: null, type: "squad", squadId: CURRENT_SQUAD },
      { conversationId: "conv-stale", lastReadAt: null, type: "squad", squadId: REMOVED_SQUAD },
      { conversationId: "conv-dm", lastReadAt: null, type: "direct", squadId: null },
    ];
    queue.value = [squads, rows];

    const total = await storage.getTotalUnreadCount(ME);

    // Current squad (5) + DM (5); the removed squad must not contribute.
    expect(total).toBe(10);
    const countedConversationIds = countSpy.mock.calls.map((c) => c[0]);
    expect(countedConversationIds).toContain("conv-current");
    expect(countedConversationIds).toContain("conv-dm");
    expect(countedConversationIds).not.toContain("conv-stale");
  });
});
