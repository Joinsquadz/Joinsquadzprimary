/**
 * Regression tests: squad name / emoji / color validation.
 *
 * CreateSquadBody and UpdateSquadBody now use .trim().min(1) so that
 * whitespace-only or empty-string values are rejected server-side rather than
 * silently stored as invisible/invalid data.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Minimal DB mock (validation is checked before any DB call) ────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: vi.fn().mockResolvedValue(undefined),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
      }),
    ),
  },
  squadsTable: {
    id: "id", name: "name", emoji: "emoji", color: "color",
    isPublic: "is_public", memberIds: "member_ids", creatorId: "creator_id",
    inviteCode: "invite_code", inviteCodeExpiresAt: "invite_code_expires_at",
    description: "description", coAdminIds: "co_admin_ids", membersCanInvite: "members_can_invite",
    version: "version",
  },
  usersTable: { id: "id", isSquadzPlus: "is_squadz_plus", foundingMember: "founding_member", moderationHidden: "moderation_hidden" },
  squadInvitesTable: { id: "id", squadId: "squad_id", inviterUserId: "inviter_user_id", invitedUserId: "invited_user_id", squadName: "squad_name", status: "status" },
  squadMutesTable: { userId: "user_id", squadId: "squad_id" },
  conversationsTable: {},
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", isSquadzPlus: false }),
    upsertUser: vi.fn(),
    getSquad: vi.fn().mockResolvedValue(null),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation(async (ids: string[]) => ids),
    clearPushToken: vi.fn(),
  },
}));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn().mockResolvedValue(false) }));
vi.mock("../lib/squadLimit", async (importOriginal) => importOriginal());

import squadsRouter from "../routes/squads";
import { makeTestApp } from "./helpers/makeTestApp";

const authedApp = makeTestApp(squadsRouter, { id: "u1" });

beforeEach(() => { vi.clearAllMocks(); });

// ── POST /api/squads — create ─────────────────────────────────────────────────
describe("POST /api/squads — name validation", () => {
  it("rejects a whitespace-only name with 400", async () => {
    const res = await request(authedApp).post("/api/squads").send({ name: "   ", emoji: "👥" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty name with 400", async () => {
    const res = await request(authedApp).post("/api/squads").send({ name: "", emoji: "👥" });
    expect(res.status).toBe(400);
  });

  it("rejects a tab-only name with 400", async () => {
    const res = await request(authedApp).post("/api/squads").send({ name: "\t\n", emoji: "👥" });
    expect(res.status).toBe(400);
  });

  it("accepts a name with surrounding whitespace (trimmed to non-empty)", async () => {
    // "  Surf Crew  " trims to "Surf Crew" — valid.
    // We just care the route doesn't return 400; it may 500 if DB mock is incomplete.
    const res = await request(authedApp).post("/api/squads").send({ name: "  Surf Crew  ", emoji: "👥" });
    expect(res.status).not.toBe(400);
  });
});

// ── PATCH /api/squads/:id — update ───────────────────────────────────────────
describe("PATCH /api/squads/:id — name/emoji/color validation", () => {
  it("rejects setting name to empty string with 400", async () => {
    const res = await request(authedApp).patch("/api/squads/s1").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects setting name to whitespace-only with 400", async () => {
    const res = await request(authedApp).patch("/api/squads/s1").send({ name: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects setting emoji to empty string with 400", async () => {
    const res = await request(authedApp).patch("/api/squads/s1").send({ emoji: "" });
    expect(res.status).toBe(400);
  });

  it("rejects setting color to empty string with 400", async () => {
    const res = await request(authedApp).patch("/api/squads/s1").send({ color: "" });
    expect(res.status).toBe(400);
  });

  it("accepts omitting name entirely (partial update)", async () => {
    // Omitting name is fine — UpdateSquadBody.name is optional.
    const res = await request(authedApp).patch("/api/squads/s1").send({ isPublic: false });
    // Not a validation 400 (may be 404/403 because DB mock returns empty).
    expect(res.status).not.toBe(400);
  });
});
