import { describe, it, expect, vi, beforeEach } from "vitest";

const attachmentRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// `vi.mock` is hoisted above imports, so the static import below still resolves
// against the mocked `@workspace/db`. Only the attachment lookup query needs a
// real return value here — the membership-aware authorization step is exercised
// via a spy on `getConversationForMember`, so the rest of the db surface can be
// minimal.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(attachmentRows.value),
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
}));

vi.mock("../lib/logger");

import { storage } from "../storage";

const OBJECT_PATH = "/objects/uploads/msg-attach-1";
const SQUAD_CONVO = "convo-squad-1";

describe("storage.canUserViewMessageAttachment — current-access enforcement", () => {
  beforeEach(() => {
    attachmentRows.value = [];
    vi.restoreAllMocks();
  });

  it("fails closed for an unknown object path (no matching message)", async () => {
    attachmentRows.value = [];
    const spy = vi.spyOn(storage, "getConversationForMember");
    const ok = await storage.canUserViewMessageAttachment(OBJECT_PATH, "anyone");
    expect(ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("grants access to a current member of the conversation", async () => {
    attachmentRows.value = [{ conversationId: SQUAD_CONVO }];
    vi.spyOn(storage, "getConversationForMember").mockResolvedValue({
      id: SQUAD_CONVO,
    } as never);
    const ok = await storage.canUserViewMessageAttachment(OBJECT_PATH, "current-member");
    expect(ok).toBe(true);
  });

  it("denies a removed former squad member even if a stale participant row remains", async () => {
    attachmentRows.value = [{ conversationId: SQUAD_CONVO }];
    // Membership-aware check returns null for a non-member.
    const memberSpy = vi
      .spyOn(storage, "getConversationForMember")
      .mockResolvedValue(null);
    // A stale conversation_participants row would make this return true, but the
    // attachment ACL must NOT rely on it.
    const participantSpy = vi
      .spyOn(storage, "isConversationParticipant")
      .mockResolvedValue(true);

    const ok = await storage.canUserViewMessageAttachment(OBJECT_PATH, "removed-member");

    expect(ok).toBe(false);
    expect(memberSpy).toHaveBeenCalledWith(SQUAD_CONVO, "removed-member");
    expect(participantSpy).not.toHaveBeenCalled();
  });
});
