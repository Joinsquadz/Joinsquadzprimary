import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * Plan Ideas — voting, notifications, and block-filtering tests (spec §6):
 * - vote toggle idempotency (on/off, never double-counts)
 * - voting only while pending
 * - threshold nudge: floor of 3 votes, majority of "going" RSVPs, 0–2 going
 *   never fires, fires exactly once per idea (atomic claim)
 * - new-idea digest reuses the shared debounce (one push, not one per idea)
 * - confirm notification fires once; pin fires none
 * - block filtering: blocked submitters' ideas and blocked users' votes are
 *   invisible; hidden (moderated) ideas excluded from list and 404 per-id
 * - pinned ideas sort above unpinned regardless of votes
 */

const S = vi.hoisted(() => ({
  events: [] as unknown[],
  ideas: [] as unknown[],
  votes: [] as unknown[],
  users: [] as unknown[],
  squads: [] as unknown[],
  maxSort: null as number | null,
  voteCount: 0,
  claimReturn: [] as unknown[],
  claimAttempts: 0,
  voteDeleteReturn: [] as unknown[],
  voteInserts: [] as unknown[],
  updateSets: [] as Record<string, unknown>[],
}));

const tableName = vi.hoisted(() => (table: unknown): string =>
  ((table as Record<string, unknown>)?.__t as string) ?? "unknown");

vi.mock("@workspace/db", () => {
  const rowsFor = (tbl: string, proj: Record<string, unknown> | undefined): unknown[] => {
    if (tbl === "events") return S.events;
    if (tbl === "squads") return S.squads;
    if (tbl === "users") return S.users;
    if (tbl === "votes") {
      if (proj && "voteCount" in proj) return [{ voteCount: S.voteCount }];
      return S.votes;
    }
    if (tbl === "ideas") {
      if (proj && "max" in proj) return [{ max: S.maxSort }];
      return S.ideas;
    }
    return [];
  };
  const chain = (get: () => unknown[]): Record<string, unknown> => ({
    where: () => chain(get),
    orderBy: () => chain(get),
    limit: () => chain(get),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(get()).then(res, rej),
  });
  const db = {
    select: (proj?: Record<string, unknown>) => ({
      from: (table: unknown) => chain(() => rowsFor(tableName(table), proj)),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (tableName(table) === "votes") S.voteInserts.push(v);
        return {
          returning: () =>
            Promise.resolve([
              {
                id: "idea-new",
                pinnedAt: null,
                sortOrder: null,
                nudgeSentAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                description: null,
                linkUrl: null,
                estimatedCost: null,
                suggestedDate: null,
                ...v,
              },
            ]),
          onConflictDoNothing: () => Promise.resolve(undefined),
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          const isClaim = "nudgeSentAt" in s && Object.keys(s).length === 1;
          if (isClaim) S.claimAttempts += 1;
          else S.updateSets.push(s);
          const result = isClaim
            ? S.claimReturn
            : [{ ...((S.ideas[0] as Record<string, unknown>) ?? {}), ...s }];
          return {
            returning: () => Promise.resolve(result),
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(undefined).then(res, rej),
          };
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: () => ({
        returning: () =>
          Promise.resolve(tableName(table) === "votes" ? S.voteDeleteReturn : []),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(undefined).then(res, rej),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        update: (_t: unknown) => ({
          set: () => ({ where: () => Promise.resolve(undefined) }),
        }),
        delete: (_t: unknown) => ({ where: () => Promise.resolve(undefined) }),
      }),
  };
  const col = (t: string, extra: Record<string, string> = {}) =>
    Object.assign({ __t: t }, extra);
  return {
    db,
    IDEA_CATEGORIES: ["activity", "food", "lodging", "transport", "other"],
    eventsTable: col("events", { id: "id", hostId: "host_id" }),
    planIdeasTable: col("ideas", {
      id: "id",
      planId: "plan_id",
      submittedByUserId: "submitted_by_user_id",
      status: "status",
      suggestedDate: "suggested_date",
      sortOrder: "sort_order",
      nudgeSentAt: "nudge_sent_at",
      pinnedAt: "pinned_at",
    }),
    ideaVotesTable: col("votes", { id: "id", ideaId: "idea_id", userId: "user_id" }),
    usersTable: col("users", {
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      profileImageUrl: "profile_image_url",
    }),
    squadsTable: col("squads", { id: "id", memberIds: "member_ids" }),
    eventCreationsTable: col("event_creations"),
    eventInvitesTable: col("event_invites"),
    activityTable: col("activity"),
  };
});

vi.mock("../storage", () => ({
  storage: {
    getSquad: vi.fn().mockResolvedValue(null),
    filterUnmutedForSquad: vi
      .fn()
      .mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue([{ token: "tok-1" }]),
    getUser: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ okCount: 1, hadSendError: false }),
}));
vi.mock("../lib/notificationDebounce", () => ({
  shouldSendNotification: vi.fn().mockReturnValue(true),
}));
vi.mock("../lib/activity", () => ({
  recordActivitySafe: vi.fn(),
  removeActivity: vi.fn(),
}));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/proStatus", () => ({
  resolveProStatus: vi.fn().mockResolvedValue({ isPlus: false }),
}));

import ideasRouter from "../routes/ideas";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { storage } from "../storage";
import { sendPushNotifications } from "../lib/pushNotifications";
import { shouldSendNotification } from "../lib/notificationDebounce";
import { trackEvent } from "../services/analytics";
import { getBlockedAndBlockerIds } from "../routes/moderation";

const HOST_ID = "host-user";
const SUBMITTER_ID = "submitter-user";
const MEMBER_ID = "member-user";
const BLOCKED_ID = "blocked-user";

const makeApp = (user?: TestUser) => makeTestApp(ideasRouter, user);
const pushMock = sendPushNotifications as unknown as ReturnType<typeof vi.fn>;
const debounceMock = shouldSendNotification as unknown as ReturnType<typeof vi.fn>;
const trackMock = trackEvent as unknown as ReturnType<typeof vi.fn>;
const blockedMock = getBlockedAndBlockerIds as unknown as ReturnType<typeof vi.fn>;
const tokensMock = storage.getPushTokensForUsers as unknown as ReturnType<typeof vi.fn>;

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    title: "Lake Trip",
    emoji: "🏕️",
    type: "trip",
    hostId: HOST_ID,
    squadId: "",
    coAdminIds: [],
    invitedUserIds: [SUBMITTER_ID, MEMBER_ID, BLOCKED_ID],
    rsvps: {},
    cancelled: false,
    date: "Aug 10-14",
    eventAt: "2099-08-10T12:00:00.000Z",
    startAt: "2099-08-10T00:00:00.000Z",
    endAt: "2099-08-14T00:00:00.000Z",
    itinerary: [],
    ...overrides,
  };
}

function makeIdea(overrides: Record<string, unknown> = {}) {
  return {
    id: "idea-1",
    planId: "evt-1",
    submittedByUserId: SUBMITTER_ID,
    title: "Sunset kayak",
    description: null,
    category: "activity",
    linkUrl: null,
    estimatedCost: null,
    suggestedDate: null,
    status: "pending",
    pinnedAt: null,
    sortOrder: null,
    nudgeSentAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Flush fire-and-forget notification promises (void notify...()). */
async function flushAsync(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  S.events = [];
  S.ideas = [];
  S.votes = [];
  S.users = [];
  S.squads = [];
  S.maxSort = null;
  S.voteCount = 0;
  S.claimReturn = [];
  S.claimAttempts = 0;
  S.voteDeleteReturn = [];
  S.voteInserts = [];
  S.updateSets = [];
  vi.clearAllMocks();
  (storage.filterUnmutedForSquad as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (ids: string[]) => Promise.resolve(ids),
  );
  tokensMock.mockResolvedValue([{ token: "tok-1" }]);
  debounceMock.mockReturnValue(true);
  blockedMock.mockResolvedValue([]);
});

describe("vote toggle", () => {
  it("toggles on when no vote exists, off when one does — idempotent", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];

    S.voteDeleteReturn = []; // no existing vote → ON
    const on = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(on.status).toBe(200);
    expect(S.voteInserts).toHaveLength(1);
    expect(trackMock).toHaveBeenCalledWith(
      MEMBER_ID,
      "idea_voted",
      expect.objectContaining({ direction: "on" }),
    );

    S.voteDeleteReturn = [{ id: "v1" }]; // existing vote → OFF, no insert
    const off = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(off.status).toBe(200);
    expect(S.voteInserts).toHaveLength(1); // unchanged
    expect(trackMock).toHaveBeenCalledWith(
      MEMBER_ID,
      "idea_voted",
      expect.objectContaining({ direction: "off" }),
    );
  });

  it("voting is only open while pending", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1 })];
    const res = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(res.status).toBe(400);
  });

  it("non-member gets 403 on vote", async () => {
    S.events = [makeTrip({ invitedUserIds: [] })];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: "stranger" })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(res.status).toBe(403);
  });
});

describe("vote-threshold nudge", () => {
  const tripWithGoing = (goingCount: number) => {
    const rsvps: Record<string, string> = {};
    for (let i = 0; i < goingCount; i++) rsvps[`going-${i}`] = "going";
    return makeTrip({ rsvps });
  };

  it("never fires with 0–2 going RSVPs, even with many votes", async () => {
    S.events = [tripWithGoing(2)];
    S.ideas = [makeIdea()];
    S.voteCount = 10;
    const res = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(res.status).toBe(200);
    await flushAsync();
    expect(S.claimAttempts).toBe(0);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("does not fire below the vote floor of 3 even past majority", async () => {
    S.events = [tripWithGoing(3)]; // majority would be 2, floor pushes to 3
    S.ideas = [makeIdea()];
    S.voteCount = 2;
    await request(makeApp({ id: MEMBER_ID })).post("/api/plans/evt-1/ideas/idea-1/vote");
    await flushAsync();
    expect(S.claimAttempts).toBe(0);
  });

  it("fires once when the threshold is crossed (atomic claim)", async () => {
    S.events = [tripWithGoing(4)]; // majority = 3, floor 3 → needed 3
    S.ideas = [makeIdea()];
    S.voteCount = 3;
    S.claimReturn = [{ id: "idea-1" }]; // claim succeeds
    await request(makeApp({ id: MEMBER_ID })).post("/api/plans/evt-1/ideas/idea-1/vote");
    await flushAsync();
    expect(S.claimAttempts).toBe(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][1].data).toMatchObject({
      type: "idea_threshold",
      screen: "trip",
      eventId: "evt-1",
      tab: "ideas",
    });
  });

  it("never re-fires after the one-time claim (nudge_sent_at already set)", async () => {
    S.events = [tripWithGoing(4)];
    S.ideas = [makeIdea()];
    S.voteCount = 4;
    S.claimReturn = []; // WHERE nudge_sent_at IS NULL matched no row
    await request(makeApp({ id: MEMBER_ID })).post("/api/plans/evt-1/ideas/idea-1/vote");
    await flushAsync();
    expect(S.claimAttempts).toBe(1); // attempted, but claim lost
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("voting OFF never evaluates the threshold", async () => {
    S.events = [tripWithGoing(5)];
    S.ideas = [makeIdea()];
    S.voteCount = 5;
    S.voteDeleteReturn = [{ id: "v1" }]; // toggle off
    await request(makeApp({ id: MEMBER_ID })).post("/api/plans/evt-1/ideas/idea-1/vote");
    await flushAsync();
    expect(S.claimAttempts).toBe(0);
  });
});

describe("new-idea digest & confirm notifications", () => {
  it("create sends one digest push via the shared debounce helper", async () => {
    S.events = [makeTrip()];
    S.users = [{ id: MEMBER_ID, firstName: "Max", lastName: null, profileImageUrl: null }];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Go-karts" });
    expect(res.status).toBe(200);
    await flushAsync();
    expect(debounceMock).toHaveBeenCalledWith(
      MEMBER_ID,
      expect.any(String),
      "idea_digest",
      expect.any(Number),
    );
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock.mock.calls[0][1].data).toMatchObject({
      type: "idea_digest",
      screen: "trip",
      eventId: "evt-1",
      tab: "ideas",
    });
  });

  it("a second idea inside the debounce window produces no second push", async () => {
    S.events = [makeTrip()];
    const app = makeApp({ id: MEMBER_ID });
    await request(app).post("/api/plans/evt-1/ideas").send({ title: "Go-karts" });
    await flushAsync();
    debounceMock.mockReturnValue(false); // within window now
    await request(app).post("/api/plans/evt-1/ideas").send({ title: "Mini golf" });
    await flushAsync();
    expect(pushMock).toHaveBeenCalledTimes(1); // digest, not one per idea
  });

  it("confirm notifies members once; pin notifies nobody", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "confirmed" });
    await flushAsync();
    expect(pushMock).toHaveBeenCalledTimes(1);
    // Confirmations land on the trip itinerary (the confirmed idea now lives there).
    expect(pushMock.mock.calls[0][1].data).toMatchObject({
      type: "idea_confirmed",
      screen: "trip",
      eventId: "evt-1",
      tab: "itinerary",
    });
    expect(trackMock).toHaveBeenCalledWith(
      HOST_ID,
      "idea_confirmed",
      expect.objectContaining({ ideaId: "idea-1" }),
    );

    pushMock.mockClear();
    S.ideas = [makeIdea()];
    await request(makeApp({ id: HOST_ID })).post("/api/plans/evt-1/ideas/idea-1/pin");
    await flushAsync();
    expect(pushMock).not.toHaveBeenCalled();
  });
});

describe("block filtering & moderation visibility", () => {
  it("excludes blocked submitters' ideas and blocked users' votes from the list", async () => {
    S.events = [makeTrip()];
    S.ideas = [
      makeIdea({ id: "idea-mine", submittedByUserId: MEMBER_ID }),
      makeIdea({ id: "idea-blocked", submittedByUserId: BLOCKED_ID }),
    ];
    S.votes = [
      { ideaId: "idea-mine", userId: SUBMITTER_ID },
      { ideaId: "idea-mine", userId: BLOCKED_ID }, // must not count
    ];
    blockedMock.mockResolvedValue([BLOCKED_ID]);
    const res = await request(makeApp({ id: MEMBER_ID })).get("/api/plans/evt-1/ideas");
    expect(res.status).toBe(200);
    const ids = res.body.ideas.map((i: { id: string }) => i.id);
    expect(ids).toEqual(["idea-mine"]);
    expect(res.body.ideas[0].voteCount).toBe(1);
  });

  it("hidden (auto-moderated) ideas are excluded from the list", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ id: "idea-hidden", status: "hidden" }), makeIdea({ id: "idea-ok" })];
    const res = await request(makeApp({ id: MEMBER_ID })).get("/api/plans/evt-1/ideas");
    const ids = res.body.ideas.map((i: { id: string }) => i.id);
    expect(ids).toEqual(["idea-ok"]);
  });

  it("hidden ideas 404 on per-id routes", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "hidden" })];
    const res = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(res.status).toBe(404);
  });

  it("pinned ideas sort above unpinned regardless of vote count", async () => {
    S.events = [makeTrip()];
    S.ideas = [
      makeIdea({ id: "idea-popular" }),
      makeIdea({ id: "idea-pinned", pinnedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    S.votes = [
      { ideaId: "idea-popular", userId: MEMBER_ID },
      { ideaId: "idea-popular", userId: SUBMITTER_ID },
    ];
    const res = await request(makeApp({ id: MEMBER_ID })).get("/api/plans/evt-1/ideas");
    const ids = res.body.ideas.map((i: { id: string }) => i.id);
    expect(ids).toEqual(["idea-pinned", "idea-popular"]);
  });

  it("free-tier user (no Squadz+) can create and vote with no gate", async () => {
    // storage.getUser resolves null and resolveProStatus is never consulted by
    // these routes — the endpoints simply don't check any pro/plan-cap state.
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const create = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Free idea" });
    const vote = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/vote",
    );
    expect(create.status).toBe(200);
    expect(vote.status).toBe(200);
  });
});
