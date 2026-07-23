// C6 — purgeSquadData deletes activity-feed notification rows referencing
// the squad and its events.
//
// When a squad is deleted (or a member leaves and they are the last member),
// purgeSquadData runs inside a transaction and must:
//   1. Delete activity rows where subjectType="event" and subjectId is one of
//      the squad's event IDs.
//   2. Delete activity rows where subjectType="squad" and subjectId=squadId.
//
// This test verifies that both delete calls are made so orphaned activity-feed
// rows do not surface after squad deletion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockEventRows = vi.hoisted(() => ({ value: [] as unknown[] }));

const activityDeleteCalls = vi.hoisted(() => ({
  calls: [] as Array<{ subjectType?: string; subjectId?: string; ids?: unknown[] }>,
}));

const activityTableRef = vi.hoisted(() => ({
  id: "id",
  recipientId: "recipient_id",
  subjectType: "subject_type",
  subjectId: "subject_id",
}));

const eventsTableRef = vi.hoisted(() => ({
  id: "id",
  squadId: "squad_id",
  version: "version",
  itinerary: "itinerary",
  polls: "polls",
  rsvps: "rsvps",
}));

const dbMock = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === eventsTableRef) return Promise.resolve(mockEventRows.value);
          return Promise.resolve(mockRows.value);
        },
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
      where: (cond: unknown) => {
        if (table === activityTableRef) {
          activityDeleteCalls.calls.push(cond as { subjectType?: string; subjectId?: string });
        }
        return Promise.resolve();
      },
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        select: () => ({
          from: (table: unknown) => ({
            where: () => {
              if (table === eventsTableRef) return Promise.resolve(mockEventRows.value);
              return Promise.resolve([]);
            },
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
          where: (cond: unknown) => {
            if (table === activityTableRef) {
              activityDeleteCalls.calls.push(cond as { subjectType?: string; subjectId?: string });
            }
            return Promise.resolve();
          },
        }),
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
            onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
          }),
        }),
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return fn(tx);
    },
  };
  return self;
});

vi.mock("@workspace/db", () => ({
  db: dbMock,
  squadsTable: {
    id: "id",
    memberIds: "member_ids",
    createdAt: "created_at",
    inviteCode: "invite_code",
    creatorId: "creator_id",
    coAdminIds: "co_admin_ids",
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    friendCode: "friend_code",
  },
  activityTable: activityTableRef,
  eventsTable: eventsTableRef,
  eventInvitesTable: { eventId: "event_id", squadId: "squad_id" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  squadRemovalNoticesTable: { id: "id", userId: "user_id", squadId: "squad_id", seenAt: "seen_at" },
  squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
  conversationsTable: { id: "id", squadId: "squad_id" },
  conversationMessagesTable: { id: "id", conversationId: "conversation_id", senderId: "sender_id" },
  conversationParticipantsTable: { userId: "user_id", conversationId: "conversation_id" },
  photosTable: { squadId: "squad_id", sharedToSquad: "shared_to_squad" },
  availabilityPollsTable: { squadId: "squad_id", createdBy: "created_by" },
  availabilityResponsesTable: { pollId: "poll_id" },
  deviceTokensTable: { userId: "user_id" },
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
    recordActivitySafe: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../lib/activity", () => ({
  recordActivitySafe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/analytics", () => ({
  trackEvent: vi.fn(),
}));
vi.mock("../services/supabase", () => ({
  supabaseAdmin: null,
  supabaseStorage: null,
}));
vi.mock("../lib/objectStorage", () => ({
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";
import { CREATOR_ID, makeBaseSquad } from "./helpers/fixtures";

const makeApp = (user?: { id: string }) => makeTestApp(squadsRouter, user);

beforeEach(() => {
  activityDeleteCalls.calls = [];
  mockRows.value = [];
  mockEventRows.value = [];
  vi.clearAllMocks();
});

describe("C6 — DELETE /api/squads/:id purges activity-feed notification rows", () => {
  it("deletes activity rows for squad events when the squad has events", async () => {
    mockRows.value = [makeBaseSquad()];
    mockEventRows.value = [{ id: "evt-1" }, { id: "evt-2" }];

    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete("/api/squads/squad-1");

    expect(res.status).toBe(204);
    const hasEventPurge = activityDeleteCalls.calls.some((c) => {
      const s = JSON.stringify(c);
      return s.includes("event");
    });
    expect(hasEventPurge).toBe(true);
  });

  it("deletes activity rows for the squad itself (subjectType=squad)", async () => {
    mockRows.value = [makeBaseSquad()];

    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete("/api/squads/squad-1");

    expect(res.status).toBe(204);
    const hasSquadPurge = activityDeleteCalls.calls.some((c) => {
      const s = JSON.stringify(c);
      return s.includes("squad");
    });
    expect(hasSquadPurge).toBe(true);
  });

  it("still returns 204 when the squad has no events (no event-activity rows to purge)", async () => {
    mockRows.value = [makeBaseSquad()];
    mockEventRows.value = [];

    const app = makeApp({ id: CREATOR_ID });
    const res = await request(app).delete("/api/squads/squad-1");

    expect(res.status).toBe(204);
    const hasSquadPurge = activityDeleteCalls.calls.some((c) =>
      JSON.stringify(c).includes("squad"),
    );
    expect(hasSquadPurge).toBe(true);
  });
});
