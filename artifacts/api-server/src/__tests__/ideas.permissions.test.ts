import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * Plan Ideas — permission & CRUD tests (spec §6):
 * - membership 403s (server-side, not client hiding)
 * - submitter-only edit/delete of own PENDING idea; locked once confirmed/archived
 * - organizer/co-admin can edit/delete any idea at any status
 * - organizer/co-admin-only status transitions, pin, reorder
 * - field validation re-runs on edit (date range, URL format)
 * - read-only after plan end/cancel (mutations 403, reads still work)
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
  voteDeleteReturn: [] as unknown[],
  insertedIdea: null as Record<string, unknown> | null,
  updateSets: [] as Record<string, unknown>[],
  txUpdateSets: [] as Record<string, unknown>[],
  txDeletes: [] as string[],
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
  // Takes a getter so beforeEach array reassignment doesn't strand the sink.
  const makeUpdate = (getSink: () => Record<string, unknown>[]) => (table: unknown) => ({
    set: (s: Record<string, unknown>) => ({
      where: () => {
        const isClaim = "nudgeSentAt" in s && Object.keys(s).length === 1;
        if (!isClaim) getSink().push(s);
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
  });
  const db = {
    select: (proj?: Record<string, unknown>) => ({
      from: (table: unknown) => chain(() => rowsFor(tableName(table), proj)),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (tableName(table) === "ideas") S.insertedIdea = v;
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
    update: makeUpdate(() => S.updateSets),
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
        update: makeUpdate(() => S.txUpdateSets),
        delete: (table: unknown) => ({
          where: () => {
            S.txDeletes.push(tableName(table));
            return Promise.resolve(undefined);
          },
        }),
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
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
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

const HOST_ID = "host-user";
const CO_ADMIN_ID = "coadmin-user";
const SUBMITTER_ID = "submitter-user";
const MEMBER_ID = "member-user";
const STRANGER_ID = "stranger-user";

const makeApp = (user?: TestUser) => makeTestApp(ideasRouter, user);

function makeTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    title: "Lake Trip",
    emoji: "🏕️",
    type: "trip",
    hostId: HOST_ID,
    squadId: "",
    coAdminIds: [CO_ADMIN_ID],
    // Co-admins are plan members through the normal channels (invite/squad);
    // coAdminIds itself grants manage rights, not access.
    invitedUserIds: [SUBMITTER_ID, MEMBER_ID, CO_ADMIN_ID],
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

function makePlainEvent(overrides: Record<string, unknown> = {}) {
  return makeTrip({
    type: "event",
    startAt: null,
    endAt: null,
    eventAt: "2099-08-10T12:00:00.000Z",
    ...overrides,
  });
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

beforeEach(() => {
  S.events = [];
  S.ideas = [];
  S.votes = [];
  S.users = [];
  S.squads = [];
  S.maxSort = null;
  S.voteCount = 0;
  S.claimReturn = [];
  S.voteDeleteReturn = [];
  S.insertedIdea = null;
  S.updateSets = [];
  S.txUpdateSets = [];
  S.txDeletes = [];
});

describe("membership gates (server-side)", () => {
  it("401 unauthenticated on list", async () => {
    const res = await request(makeApp()).get("/api/plans/evt-1/ideas");
    expect(res.status).toBe(401);
  });

  it("403 for a non-member on list — ideas never leak outside the plan", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: STRANGER_ID })).get("/api/plans/evt-1/ideas");
    expect(res.status).toBe(403);
  });

  it("403 for a non-member on create", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: STRANGER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Crash the trip" });
    expect(res.status).toBe(403);
  });

  it("404 when the plan does not exist", async () => {
    const res = await request(makeApp({ id: HOST_ID })).get("/api/plans/nope/ideas");
    expect(res.status).toBe(404);
  });

  it("a removed member (no longer invited) gets 403 on further submissions", async () => {
    S.events = [makeTrip({ invitedUserIds: [MEMBER_ID] })]; // submitter was removed
    const res = await request(makeApp({ id: SUBMITTER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Still here?" });
    expect(res.status).toBe(403);
  });

  it("rsvp'd member of a plain event can create (any RSVP status counts)", async () => {
    S.events = [makePlainEvent({ invitedUserIds: [], rsvps: { [MEMBER_ID]: "maybe" } })];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Bowling night" });
    expect(res.status).toBe(200);
    expect(S.insertedIdea?.submittedByUserId).toBe(MEMBER_ID);
    expect(S.insertedIdea?.status).toBe("pending");
  });
});

describe("create validation", () => {
  it("rejects a title over 100 chars", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "x".repeat(101) });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed link_url with a clear 400, not a 500", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", linkUrl: "not a url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid URL/i);
  });

  it("rejects non-http(s) link protocols", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", linkUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("rejects suggested_date outside the trip range", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", suggestedDate: "2099-08-20" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/within the trip/i);
  });

  it("rejects suggested_date on an event-type plan", async () => {
    S.events = [makePlainEvent({ rsvps: { [MEMBER_ID]: "going" } })];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", suggestedDate: "2099-08-10" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only trips/i);
  });

  it("accepts an in-range suggested_date on a trip (same day keys as stops)", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", suggestedDate: "2099-08-12", category: "food" });
    expect(res.status).toBe(200);
    expect(S.insertedIdea?.suggestedDate).toBe("2099-08-12");
    expect(S.insertedIdea?.category).toBe("food");
  });

  it("forces category to activity on plain events", async () => {
    S.events = [makePlainEvent({ rsvps: { [MEMBER_ID]: "going" } })];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Kayaks", category: "lodging" });
    expect(res.status).toBe(200);
    expect(S.insertedIdea?.category).toBe("activity");
  });
});

describe("edit permissions", () => {
  it("submitter can edit their own pending idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: SUBMITTER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ title: "Sunrise kayak" });
    expect(res.status).toBe(200);
    expect(S.updateSets.some((s) => s.title === "Sunrise kayak")).toBe(true);
  });

  it("submitter gets 403 editing their own CONFIRMED idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1 })];
    const res = await request(makeApp({ id: SUBMITTER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ title: "Nope" });
    expect(res.status).toBe(403);
  });

  it("submitter gets 403 editing their own ARCHIVED idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "archived" })];
    const res = await request(makeApp({ id: SUBMITTER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ title: "Nope" });
    expect(res.status).toBe(403);
  });

  it("another member gets 403 editing someone else's idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ title: "Mine now" });
    expect(res.status).toBe(403);
  });

  it("co-admin can edit any idea at any status", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 2 })];
    const res = await request(makeApp({ id: CO_ADMIN_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ title: "Typo fixed" });
    expect(res.status).toBe(200);
  });

  it("edits re-validate: out-of-range suggested_date rejected on edit", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ suggestedDate: "2099-09-01" });
    expect(res.status).toBe(400);
  });

  it("edits re-validate: malformed URL rejected on edit with 400", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: SUBMITTER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ linkUrl: "htp:/broken" });
    expect(res.status).toBe(400);
  });

  it("organizer date change on a CONFIRMED idea appends to end of target group", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1, suggestedDate: "2099-08-11" })];
    S.maxSort = 4; // target group already has 4 confirmed ideas
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ suggestedDate: "2099-08-13" });
    expect(res.status).toBe(200);
    const set = S.updateSets.find((s) => "suggestedDate" in s);
    expect(set?.sortOrder).toBe(5);
  });

  it("clearing the date on a CONFIRMED idea appends to the General group", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 2, suggestedDate: "2099-08-11" })];
    S.maxSort = null; // General group empty
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1")
      .send({ suggestedDate: null });
    expect(res.status).toBe(200);
    const set = S.updateSets.find((s) => "suggestedDate" in s);
    expect(set?.suggestedDate).toBe(null);
    expect(set?.sortOrder).toBe(1);
  });
});

describe("delete permissions & vote cascade", () => {
  it("submitter can delete their own pending idea (votes deleted too)", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: SUBMITTER_ID })).delete(
      "/api/plans/evt-1/ideas/idea-1",
    );
    expect(res.status).toBe(200);
    expect(S.txDeletes).toEqual(["votes", "ideas"]); // no orphaned vote rows
  });

  it("submitter gets 403 deleting their own confirmed idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1 })];
    const res = await request(makeApp({ id: SUBMITTER_ID })).delete(
      "/api/plans/evt-1/ideas/idea-1",
    );
    expect(res.status).toBe(403);
    expect(S.txDeletes).toEqual([]);
  });

  it("organizer can delete a confirmed idea (removes it from the itinerary)", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1 })];
    const res = await request(makeApp({ id: HOST_ID })).delete(
      "/api/plans/evt-1/ideas/idea-1",
    );
    expect(res.status).toBe(200);
    expect(S.txDeletes).toEqual(["votes", "ideas"]);
  });

  it("other members get 403 deleting someone else's idea", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: MEMBER_ID })).delete(
      "/api/plans/evt-1/ideas/idea-1",
    );
    expect(res.status).toBe(403);
  });
});

describe("status transitions (organizer/co-admin only)", () => {
  it("regular member gets 403", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "confirmed" });
    expect(res.status).toBe(403);
  });

  it("confirm assigns sort_order at the end of the idea's day group", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ suggestedDate: "2099-08-11" })];
    S.maxSort = 2;
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "confirmed" });
    expect(res.status).toBe(200);
    const set = S.updateSets.find((s) => s.status === "confirmed");
    expect(set?.sortOrder).toBe(3);
  });

  it("un-confirm clears sort_order", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 3 })];
    const res = await request(makeApp({ id: CO_ADMIN_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "pending" });
    expect(res.status).toBe(200);
    const set = S.updateSets.find((s) => s.status === "pending");
    expect(set?.sortOrder).toBe(null);
  });

  it("pending → archived and archived → pending (reactivate) both work", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const archive = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "archived" });
    expect(archive.status).toBe(200);

    S.ideas = [makeIdea({ status: "archived" })];
    const reactivate = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "pending" });
    expect(reactivate.status).toBe(200);
  });

  it("rejects invalid transitions (confirmed → archived)", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ status: "confirmed", sortOrder: 1 })];
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/idea-1/status")
      .send({ status: "archived" });
    expect(res.status).toBe(400);
  });
});

describe("pin (organizer/co-admin only, no notification)", () => {
  it("regular member gets 403 on pin", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: MEMBER_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/pin",
    );
    expect(res.status).toBe(403);
  });

  it("organizer pin toggles pinned_at on and off", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea()];
    const on = await request(makeApp({ id: HOST_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/pin",
    );
    expect(on.status).toBe(200);
    expect(S.updateSets[0]?.pinnedAt).toBeInstanceOf(Date);

    S.updateSets = [];
    S.ideas = [makeIdea({ pinnedAt: "2026-08-01T00:00:00.000Z" })];
    const off = await request(makeApp({ id: HOST_ID })).post(
      "/api/plans/evt-1/ideas/idea-1/pin",
    );
    expect(off.status).toBe(200);
    expect(S.updateSets[0]?.pinnedAt).toBe(null);
  });
});

describe("reorder (organizer/co-admin only, atomic)", () => {
  it("regular member gets 403", async () => {
    S.events = [makeTrip()];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .patch("/api/plans/evt-1/ideas/reorder")
      .send({ date: null, ideaIds: ["idea-1"] });
    expect(res.status).toBe(403);
  });

  it("reassigns sort_order 1..n in payload order inside one transaction", async () => {
    S.events = [makeTrip()];
    S.ideas = [
      makeIdea({ id: "idea-a", status: "confirmed" }),
      makeIdea({ id: "idea-b", status: "confirmed" }),
      makeIdea({ id: "idea-c", status: "confirmed" }),
    ];
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/reorder")
      .send({ date: null, ideaIds: ["idea-c", "idea-a", "idea-b"] });
    expect(res.status).toBe(200);
    expect(S.txUpdateSets.map((s) => s.sortOrder)).toEqual([1, 2, 3]);
  });

  it("rejects the whole payload when it contains a foreign or non-confirmed id", async () => {
    S.events = [makeTrip()];
    S.ideas = [
      makeIdea({ id: "idea-a", status: "confirmed" }),
      makeIdea({ id: "idea-b", status: "confirmed" }),
    ];
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/reorder")
      .send({ date: null, ideaIds: ["idea-a", "other-plan-idea"] });
    expect(res.status).toBe(400);
    expect(S.txUpdateSets).toEqual([]); // no partial reorder
  });

  it("rejects duplicate ids", async () => {
    S.events = [makeTrip()];
    S.ideas = [makeIdea({ id: "idea-a", status: "confirmed" })];
    const res = await request(makeApp({ id: HOST_ID }))
      .patch("/api/plans/evt-1/ideas/reorder")
      .send({ date: null, ideaIds: ["idea-a", "idea-a"] });
    expect(res.status).toBe(400);
  });
});

describe("read-only after plan end / cancellation", () => {
  const endedTrip = () =>
    makeTrip({
      startAt: "2020-01-01T00:00:00.000Z",
      endAt: "2020-01-05T00:00:00.000Z",
      eventAt: "2020-01-01T12:00:00.000Z",
    });

  it("reads still work and flag readOnly", async () => {
    S.events = [endedTrip()];
    S.ideas = [makeIdea()];
    const res = await request(makeApp({ id: MEMBER_ID })).get("/api/plans/evt-1/ideas");
    expect(res.status).toBe(200);
    expect(res.body.readOnly).toBe(true);
    expect(res.body.ideas).toHaveLength(1);
  });

  it("submit / edit / vote / status / pin / reorder all 403 with a clear message", async () => {
    S.events = [endedTrip()];
    S.ideas = [makeIdea()];
    const app = makeApp({ id: HOST_ID }); // even the organizer is locked out
    const results = await Promise.all([
      request(app).post("/api/plans/evt-1/ideas").send({ title: "Late" }),
      request(app).patch("/api/plans/evt-1/ideas/idea-1").send({ title: "Late" }),
      request(app).delete("/api/plans/evt-1/ideas/idea-1"),
      request(app).post("/api/plans/evt-1/ideas/idea-1/vote"),
      request(app).patch("/api/plans/evt-1/ideas/idea-1/status").send({ status: "confirmed" }),
      request(app).post("/api/plans/evt-1/ideas/idea-1/pin"),
      request(app).patch("/api/plans/evt-1/ideas/reorder").send({ date: null, ideaIds: ["idea-1"] }),
    ]);
    for (const r of results) {
      expect(r.status).toBe(403);
      expect(r.body.error).toMatch(/read-only/i);
    }
  });

  it("cancelled plan is read-only too", async () => {
    S.events = [makeTrip({ cancelled: true })];
    const res = await request(makeApp({ id: MEMBER_ID }))
      .post("/api/plans/evt-1/ideas")
      .send({ title: "Late" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cancelled/i);
  });
});
