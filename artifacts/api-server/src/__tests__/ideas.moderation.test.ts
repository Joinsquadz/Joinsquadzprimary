import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/**
 * Plan Ideas — report-flow integration (spec §5):
 * - "idea" is a reportable content type through the existing report flow
 * - auto-hide fires at 3 distinct reporters (sets plan_ideas.status = 'hidden')
 * - the reporter must be able to view the idea (SEC-01 gate applies to ideas)
 */

const S = vi.hoisted(() => ({
  reportRows: [] as unknown[],
  insertReturn: [{ id: "report-1" }] as unknown[],
  ideaUpdates: [] as Record<string, unknown>[],
  updatedTables: [] as string[],
}));

const tableName = vi.hoisted(() => (table: unknown): string =>
  ((table as Record<string, unknown>)?.__t as string) ?? "unknown");

vi.mock("@workspace/db", () => {
  const chain = (get: () => unknown[]): Record<string, unknown> => ({
    where: () => chain(get),
    orderBy: () => chain(get),
    limit: () => chain(get),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(get()).then(res, rej),
  });
  const db = {
    select: () => ({ from: () => chain(() => S.reportRows) }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(S.insertReturn),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          S.updatedTables.push(tableName(table));
          if (tableName(table) === "ideas") S.ideaUpdates.push(s);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  const col = (t: string, extra: Record<string, string> = {}) =>
    Object.assign({ __t: t }, extra);
  return {
    db,
    reportsTable: col("reports", {
      id: "id",
      reporterId: "reporter_id",
      contentType: "content_type",
      contentId: "content_id",
    }),
    userBlocksTable: col("blocks"),
    feedPostsTable: col("posts"),
    momentsTable: col("moments"),
    photosTable: col("photos"),
    conversationMessagesTable: col("messages"),
    usersTable: col("users"),
    planIdeasTable: col("ideas", { id: "id", status: "status" }),
  };
});

vi.mock("../storage", () => ({
  storage: {
    canUserViewReportedContent: vi.fn().mockResolvedValue(true),
    getUser: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/logger");
vi.mock("../services/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import moderationRouter from "../routes/moderation";
import { makeTestApp } from "./helpers/makeTestApp";
import { storage } from "../storage";

const canViewMock = storage.canUserViewReportedContent as unknown as ReturnType<typeof vi.fn>;

/** Flush the fire-and-forget maybeAutoHide promise. */
async function flushAsync(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

beforeEach(() => {
  S.reportRows = [];
  S.insertReturn = [{ id: "report-1" }];
  S.ideaUpdates = [];
  S.updatedTables = [];
  vi.clearAllMocks();
  canViewMock.mockResolvedValue(true);
});

describe("POST /api/reports with contentType 'idea'", () => {
  const reportBody = {
    contentType: "idea",
    contentId: "idea-1",
    targetUserId: "submitter-user",
    reason: "spam",
  };

  it("accepts an idea report and checks reporter visibility (SEC-01)", async () => {
    S.reportRows = [{ reporterId: "reporter-1" }];
    const res = await request(makeTestApp(moderationRouter, { id: "reporter-1" }))
      .post("/api/reports")
      .send(reportBody);
    expect(res.status).toBe(200);
    expect(canViewMock).toHaveBeenCalledWith("idea", "idea-1", "reporter-1");
  });

  it("403s when the reporter cannot view the idea (no coordinated auto-hide)", async () => {
    canViewMock.mockResolvedValue(false);
    const res = await request(makeTestApp(moderationRouter, { id: "outsider" }))
      .post("/api/reports")
      .send(reportBody);
    expect(res.status).toBe(403);
  });

  it("does NOT auto-hide below 3 distinct reporters", async () => {
    S.reportRows = [{ reporterId: "r1" }, { reporterId: "r2" }];
    await request(makeTestApp(moderationRouter, { id: "r2" }))
      .post("/api/reports")
      .send(reportBody);
    await flushAsync();
    expect(S.ideaUpdates).toEqual([]);
  });

  it("auto-hides the idea at 3 distinct reporters (status = hidden)", async () => {
    S.reportRows = [{ reporterId: "r1" }, { reporterId: "r2" }, { reporterId: "r3" }];
    await request(makeTestApp(moderationRouter, { id: "r3" }))
      .post("/api/reports")
      .send(reportBody);
    await flushAsync();
    expect(S.ideaUpdates).toEqual([{ status: "hidden" }]);
    expect(S.updatedTables).toContain("ideas");
  });

  it("3 duplicate reports from the SAME reporter do not auto-hide", async () => {
    S.reportRows = [
      { reporterId: "r1" },
      { reporterId: "r1" },
      { reporterId: "r1" },
    ];
    await request(makeTestApp(moderationRouter, { id: "r1" }))
      .post("/api/reports")
      .send(reportBody);
    await flushAsync();
    expect(S.ideaUpdates).toEqual([]);
  });
});
