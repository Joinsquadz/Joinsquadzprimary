/**
 * Live authorization for EXISTING direct threads.
 *
 * Participant rows are append-only, so `getConversationForMember` still says
 * "member" after an unfriend or a block. Every DM surface must therefore go
 * through `directThreadDenialReason` / `canAccessConversation` — including the
 * storage ACL that hands out message-attachment bytes, which is the one path
 * that leaks actual content rather than just UI access.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectQueue = vi.hoisted(() => ({ rows: [] as unknown[][] }));
const attachmentRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectQueue.rows.shift() ?? []),
      }),
    }),
  },
  usersTable: {},
  eventsTable: {},
  squadsTable: {},
  photosTable: {},
  conversationsTable: {},
  conversationParticipantsTable: {},
  conversationMessagesTable: { conversationId: "conversation_id", attachments: "attachments" },
  friendshipsTable: { id: "id", ownerId: "owner_id", friendId: "friend_id" },
  userBlocksTable: { blockerId: "blocker_id", blockedId: "blocked_id" },
}));

vi.mock("../lib/logger");

import { storage } from "../storage";

const CONVO = "convo-direct-1";
const ME = "me-1";
const THEM = "them-1";
const OBJECT_PATH = "/objects/uploads/dm-attach-1";

/** Queue the two block lookups (blocked-by-me, blockers-of-me). */
function blocks(blockedByMe: string[], blockersOfMe: string[]) {
  selectQueue.rows.push(blockedByMe.map((id) => ({ id })));
  selectQueue.rows.push(blockersOfMe.map((id) => ({ id })));
}

beforeEach(() => {
  vi.restoreAllMocks();
  selectQueue.rows = [];
  attachmentRows.value = [];
  vi.spyOn(storage, "getConversationParticipants").mockResolvedValue([
    { userId: ME },
    { userId: THEM },
  ] as never);
});

describe("storage.directThreadDenialReason", () => {
  it("allows the thread while the two are friends and unblocked", async () => {
    blocks([], []);
    vi.spyOn(storage, "areUsersFriends").mockResolvedValue(true);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBeNull();
  });

  it("closes the thread after an unfriend, even though the participant row remains", async () => {
    blocks([], []);
    vi.spyOn(storage, "areUsersFriends").mockResolvedValue(false);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBe("not_friends");
  });

  it("closes the thread when the caller blocked the other person", async () => {
    blocks([THEM], []);
    vi.spyOn(storage, "areUsersFriends").mockResolvedValue(true);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBe("blocked");
  });

  it("closes the thread when the OTHER person blocked the caller (reverse direction)", async () => {
    blocks([], [THEM]);
    vi.spyOn(storage, "areUsersFriends").mockResolvedValue(true);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBe("blocked");
  });

  it("reports 'blocked' rather than 'not_friends' when both apply (block copy is neutral)", async () => {
    blocks([THEM], []);
    vi.spyOn(storage, "areUsersFriends").mockResolvedValue(false);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBe("blocked");
  });

  it("allows a thread with no other participant (self-thread edge case)", async () => {
    vi.spyOn(storage, "getConversationParticipants").mockResolvedValue([
      { userId: ME },
    ] as never);

    expect(await storage.directThreadDenialReason(CONVO, ME)).toBeNull();
  });
});

describe("storage.canAccessConversation", () => {
  it("denies a non-member outright", async () => {
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue(null);
    const gate = vi.spyOn(storage, "directThreadDenialReason");

    expect(await storage.canAccessConversation(CONVO, ME)).toBe(false);
    expect(gate).not.toHaveBeenCalled();
  });

  it("denies a member of a direct thread that is no longer open", async () => {
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: CONVO,
      type: "direct",
    } as never);
    vi.spyOn(storage, "directThreadDenialReason").mockResolvedValue("not_friends");

    expect(await storage.canAccessConversation(CONVO, ME)).toBe(false);
  });

  it("allows a squad conversation without consulting the friendship gate", async () => {
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: "convo-squad-1",
      type: "squad",
    } as never);
    const gate = vi.spyOn(storage, "directThreadDenialReason");

    expect(await storage.canAccessConversation("convo-squad-1", ME)).toBe(true);
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("storage.canUserViewMessageAttachment — closed DMs stop serving bytes", () => {
  it("denies attachment bytes from a DM closed by an unfriend", async () => {
    attachmentRows.value = [{ conversationId: CONVO }];
    selectQueue.rows.push(attachmentRows.value);
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: CONVO,
      type: "direct",
    } as never);
    vi.spyOn(storage, "directThreadDenialReason").mockResolvedValue("not_friends");

    expect(await storage.canUserViewMessageAttachment(OBJECT_PATH, ME)).toBe(false);
  });

  it("denies attachment bytes from a DM closed by a block", async () => {
    attachmentRows.value = [{ conversationId: CONVO }];
    selectQueue.rows.push(attachmentRows.value);
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: CONVO,
      type: "direct",
    } as never);
    vi.spyOn(storage, "directThreadDenialReason").mockResolvedValue("blocked");

    expect(await storage.canUserViewMessageAttachment(OBJECT_PATH, ME)).toBe(false);
  });

  it("still serves attachment bytes while the DM is open", async () => {
    attachmentRows.value = [{ conversationId: CONVO }];
    selectQueue.rows.push(attachmentRows.value);
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: CONVO,
      type: "direct",
    } as never);
    vi.spyOn(storage, "directThreadDenialReason").mockResolvedValue(null);

    expect(await storage.canUserViewMessageAttachment(OBJECT_PATH, ME)).toBe(true);
  });

  it("still serves squad-chat attachments to current squad members", async () => {
    attachmentRows.value = [{ conversationId: "convo-squad-1" }];
    selectQueue.rows.push(attachmentRows.value);
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: "convo-squad-1",
      type: "squad",
    } as never);
    const gate = vi.spyOn(storage, "directThreadDenialReason");

    expect(await storage.canUserViewMessageAttachment(OBJECT_PATH, ME)).toBe(true);
    expect(gate).not.toHaveBeenCalled();
  });
});
