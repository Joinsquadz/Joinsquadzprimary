import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express, {
  type Request,
  type Response,
  type NextFunction,
  type Router,
} from "express";
import request from "supertest";

/**
 * MULTI-USER SIMULATION — 18 overlapping users against a REAL Postgres.
 *
 * This is the pre-launch confidence sweep for the privacy/safety work: the 13+
 * age gate, friends-only DMs, in-context friend requests, and mutual blocking —
 * plus the squad/plan/chat concurrency guarantees exercised by a realistic
 * cohort rather than isolated pairs.
 *
 * The users are deliberately NOT independent: they share squads, share plans,
 * and act at the same instant, because every real bug this project has found
 * lived in the overlap (a stale participant row, a lost member-list write, a
 * request that raced a block).
 *
 * Like its siblings in this directory it boots a throwaway local Postgres,
 * refuses to run against Supabase/remote, and drives the REAL route handlers
 * over HTTP. Runs via `pnpm --filter @workspace/api-server run test:concurrency`.
 */

let baseDir = "";
let dataDir = "";
let pgStarted = false;
let dbmod: typeof import("@workspace/db");
let app: express.Express;
let storage: typeof import("../../storage").storage;

/** The simulated cohort: u01..u18. */
const COHORT = Array.from({ length: 18 }, (_, i) => `u${String(i + 1).padStart(2, "0")}`);

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// Header-based auth shim so one app instance can act as many concurrent users.
// The /api/auth/* routes under test are unauthenticated, so they are unaffected.
function buildApp(...routers: Router[]): express.Express {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const uid = req.header("x-test-user");
    req.isAuthenticated = function (this: Request) {
      return uid != null;
    } as Request["isAuthenticated"];
    if (uid) req.user = { id: uid } as Express.User;
    next();
  });
  for (const r of routers) a.use("/api", r);
  a.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err?.message ?? "Internal Server Error" });
  });
  return a;
}

beforeAll(async () => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "squadz-sim-pg-"));
  dataDir = path.join(baseDir, "data");
  const sockDir = path.join(baseDir, "sock");
  fs.mkdirSync(sockDir);
  const logFile = path.join(baseDir, "pg.log");
  const port = await getFreePort();

  execFileSync("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"], {
    stdio: "pipe",
  });
  execFileSync(
    "pg_ctl",
    ["-D", dataDir, "-l", logFile, "-o", `-p ${port} -h 127.0.0.1 -k ${sockDir}`, "-w", "start"],
    { stdio: "pipe" },
  );
  pgStarted = true;

  // Lock the env to the local cluster and PROVE we can't reach prod. Clearing
  // SUPABASE_* also forces /api/auth/register down its own DB path, which is
  // the path we want to age-gate here.
  for (const k of [
    "SUPABASE_DB_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ANON_KEY",
    "DATABASE_URL",
    "DB_POOLER_PORT",
    "DB_POOL_MAX",
  ]) {
    delete process.env[k];
  }
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  if (process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
    throw new Error("refusing to run: Supabase env still set after teardown");
  }
  if (!process.env.DATABASE_URL.includes("127.0.0.1")) {
    throw new Error("refusing to run: DATABASE_URL is not the local ephemeral cluster");
  }
  if (process.env.DB_POOLER_PORT) {
    throw new Error("refusing to run: DB_POOLER_PORT still set after teardown");
  }

  const dbPkgDir = path.resolve(process.cwd(), "../../lib/db");
  const drizzleBin = path.join(dbPkgDir, "node_modules/.bin/drizzle-kit");
  const outDir = path.join(baseDir, "drizzle");
  execFileSync(
    drizzleBin,
    ["generate", "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--out", outDir],
    { cwd: dbPkgDir, stdio: "pipe" },
  );

  dbmod = await import("@workspace/db");
  const sqlFiles = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of sqlFiles) {
    const raw = fs.readFileSync(path.join(outDir, f), "utf8");
    const stmts = raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of stmts) {
      await dbmod.pool.query(stmt);
    }
  }

  const authRouter = (await import("../../routes/auth")).default;
  const usersRouter = (await import("../../routes/users")).default;
  const friendRequestsRouter = (await import("../../routes/friendRequests")).default;
  const moderationRouter = (await import("../../routes/moderation")).default;
  const conversationsRouter = (await import("../../routes/conversations")).default;
  const squadsRouter = (await import("../../routes/squads")).default;
  const eventsRouter = (await import("../../routes/events")).default;
  app = buildApp(
    authRouter,
    usersRouter,
    friendRequestsRouter,
    moderationRouter,
    conversationsRouter,
    squadsRouter,
    eventsRouter,
  );
  storage = (await import("../../storage")).storage;

  await Promise.all(COHORT.map((id) => seedUser(id)));
}, 120_000);

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 250));
  try {
    await dbmod?.pool?.end();
  } catch {
    // ignore
  }
  if (pgStarted) {
    try {
      execFileSync("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "pipe" });
    } catch {
      // ignore
    }
  }
  if (baseDir) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function seedUser(id: string): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO users (id, email, first_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.test`, id.toUpperCase()],
  );
}

async function seedSquad(id: string, creator: string, memberIds: string[], isPublic = false) {
  await dbmod.pool.query(
    `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [id, `Squad ${id}`, creator, JSON.stringify(memberIds), isPublic, `CODE-${id}`],
  );
}

async function seedEvent(
  id: string,
  hostId: string,
  opts: { squadId?: string; rsvps?: Record<string, string>; invited?: string[] } = {},
) {
  await dbmod.pool.query(
    `INSERT INTO events (id, title, date, location, host_id, invite_code, squad_id, rsvps, invited_user_ids, polls, costs, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'[]'::jsonb,'[]'::jsonb,0)`,
    [
      id,
      `Plan ${id}`,
      "2026-12-31",
      "Somewhere",
      hostId,
      `INV-${id}`,
      opts.squadId ?? "",
      JSON.stringify(opts.rsvps ?? { [hostId]: "going" }),
      JSON.stringify(opts.invited ?? []),
    ],
  );
}

async function makeFriends(a: string, b: string): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO friendships (owner_id, friend_id) VALUES ($1,$2),($2,$1)
     ON CONFLICT (owner_id, friend_id) DO NOTHING`,
    [a, b],
  );
}

async function friendshipCount(a: string, b: string): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT count(*)::int AS c FROM friendships
      WHERE (owner_id = $1 AND friend_id = $2) OR (owner_id = $2 AND friend_id = $1)`,
    [a, b],
  );
  return rows[0]?.c ?? 0;
}

async function pendingRequestsBetween(a: string, b: string): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT count(*)::int AS c FROM friend_requests
      WHERE status = 'pending'
        AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))`,
    [a, b],
  );
  return rows[0]?.c ?? 0;
}

async function squadMemberIds(id: string): Promise<string[]> {
  const { rows } = await dbmod.pool.query(`SELECT member_ids FROM squads WHERE id = $1`, [id]);
  return (rows[0]?.member_ids ?? []) as string[];
}

async function eventRsvps(id: string): Promise<Record<string, string>> {
  const { rows } = await dbmod.pool.query(`SELECT rsvps FROM events WHERE id = $1`, [id]);
  return (rows[0]?.rsvps ?? {}) as Record<string, string>;
}

async function eventCosts(id: string): Promise<Array<{ amount: number }>> {
  const { rows } = await dbmod.pool.query(`SELECT costs FROM events WHERE id = $1`, [id]);
  return (rows[0]?.costs ?? []) as Array<{ amount: number }>;
}

async function eventVersion(id: string): Promise<number> {
  const { rows } = await dbmod.pool.query(`SELECT version FROM events WHERE id = $1`, [id]);
  return rows[0]?.version ?? 0;
}

/** The register route is IP-rate-limited (10/window); clear it between signups. */
async function clearRateLimits(): Promise<void> {
  await dbmod.pool.query(`DELETE FROM rate_limits`);
}

async function userRowByEmail(email: string) {
  const { rows } = await dbmod.pool.query(
    `SELECT id, meets_min_age, birth_year FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

const THIS_YEAR = new Date().getFullYear();

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — Onboarding: the 13+ age gate is enforced by the SERVER
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-1 — age gate holds against direct API signups", () => {
  it("rejects an under-13 signup with 403 and creates NO account", async () => {
    await clearRateLimits();
    const email = "kid@example.test";
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "password123", birthYear: String(THIS_YEAR - 9) });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UNDER_MIN_AGE");
    expect(await userRowByEmail(email)).toBeNull();
  });

  it("cannot be bypassed by passing the derived age fields directly", async () => {
    await clearRateLimits();
    const email = "spoofer@example.test";
    const res = await request(app).post("/api/auth/register").send({
      email,
      password: "password123",
      birthYear: String(THIS_YEAR - 8),
      // A hand-rolled client trying to assert its own compliance.
      meetsMinAge: true,
      birthYearVerified: true,
    });

    expect(res.status).toBe(403);
    expect(await userRowByEmail(email)).toBeNull();
  });

  it("rejects a missing birth year (400) rather than defaulting it", async () => {
    await clearRateLimits();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "nobirth@example.test", password: "password123" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BIRTH_YEAR_REQUIRED");
    expect(await userRowByEmail("nobirth@example.test")).toBeNull();
  });

  it("accepts a just-turned-13 signup and stores ONLY the marker + birth year", async () => {
    await clearRateLimits();
    const email = "thirteen@example.test";
    const birthYear = THIS_YEAR - 13;
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "password123", birthYear: String(birthYear) });

    expect(res.status).toBe(200);
    const row = await userRowByEmail(email);
    expect(row).not.toBeNull();
    expect(row.meets_min_age).toBe(true);
    expect(row.birth_year).toBe(birthYear);
    // No exact date of birth is persisted anywhere on the row.
    const { rows: cols } = await dbmod.pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'users' AND column_name IN ('date_of_birth','dob','birth_date')`,
    );
    expect(cols).toHaveLength(0);
  });

  it("accepts an adult signup", async () => {
    await clearRateLimits();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "adult@example.test", password: "password123", birthYear: String(THIS_YEAR - 30) });
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — Friends-only DMs across a shared squad
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-2 — a shared squad never grants a DM", () => {
  const A = "u01";
  const B = "u02";

  beforeAll(async () => {
    await seedSquad("sq-dm", A, [A, B, "u03", "u04"]);
  });

  it("squad-mates who are not friends cannot open a DM (server-enforced)", async () => {
    const res = await request(app)
      .post("/api/conversations/direct")
      .set("x-test-user", A)
      .send({ userId: B });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_FRIENDS");
  });

  it("the same pair CAN group-chat in the squad they share", async () => {
    const res = await request(app).get("/api/conversations/squad/sq-dm").set("x-test-user", B);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });

  it("once friended, the DM opens and both can read it", async () => {
    await makeFriends(A, B);
    const created = await request(app)
      .post("/api/conversations/direct")
      .set("x-test-user", A)
      .send({ userId: B });
    expect(created.status).toBe(201);
    const convoId = created.body.id;

    const sent = await request(app)
      .post(`/api/conversations/${convoId}/messages`)
      .set("x-test-user", A)
      .send({ text: "hey" });
    expect(sent.status).toBeLessThan(300);

    const read = await request(app)
      .get(`/api/conversations/${convoId}/messages`)
      .set("x-test-user", B);
    expect(read.status).toBe(200);
    expect(read.body.messages.length).toBeGreaterThan(0);
  });

  it("unfriending closes the EXISTING thread for both read and send", async () => {
    const convo = await storage.getOrCreateDirectConversation(A, B);

    const removed = await request(app)
      .delete(`/api/users/friends/${B}`)
      .set("x-test-user", A);
    expect(removed.status).toBeLessThan(300);

    const read = await request(app)
      .get(`/api/conversations/${convo.id}/messages`)
      .set("x-test-user", B);
    expect(read.status).toBe(403);

    const send = await request(app)
      .post(`/api/conversations/${convo.id}/messages`)
      .set("x-test-user", B)
      .send({ text: "still here?" });
    expect(send.status).toBe(403);

    // Read receipts write state onto the thread — they must be gated too.
    const markRead = await request(app)
      .post(`/api/conversations/${convo.id}/read`)
      .set("x-test-user", B);
    expect(markRead.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — In-context friend requests (no friend code needed)
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-3 — in-context friend requests from a shared squad", () => {
  const A = "u05";
  const B = "u06";
  const C = "u07";

  beforeAll(async () => {
    await seedSquad("sq-fr", A, [A, B, C]);
  });

  it("a squad-mate can request without a code, and accepting unlocks the DM", async () => {
    const sent = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", A)
      .send({ toUserId: B });
    expect(sent.status).toBe(200);
    const requestId = sent.body.requestId;

    const accepted = await request(app)
      .post(`/api/users/friend-requests/${requestId}/accept`)
      .set("x-test-user", B);
    expect(accepted.status).toBe(200);
    expect(await friendshipCount(A, B)).toBe(2);

    const dm = await request(app)
      .post("/api/conversations/direct")
      .set("x-test-user", B)
      .send({ userId: A });
    expect(dm.status).toBe(201);
  });

  it("declining between squad-mates leaves no friendship and no DM", async () => {
    const sent = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", A)
      .send({ toUserId: C });
    expect(sent.status).toBe(200);

    const declined = await request(app)
      .post(`/api/users/friend-requests/${sent.body.requestId}/decline`)
      .set("x-test-user", C);
    expect(declined.status).toBe(200);

    expect(await friendshipCount(A, C)).toBe(0);
    const dm = await request(app)
      .post("/api/conversations/direct")
      .set("x-test-user", A)
      .send({ userId: C });
    expect(dm.status).toBe(403);
  });

  it("a declined request can be sent again later (the pair is not permanently stuck)", async () => {
    // (from_user_id, to_user_id) is unique regardless of status, so the second
    // attempt used to hit the constraint and 500.
    const retry = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", A)
      .send({ toUserId: C });
    expect(retry.status).toBe(200);
    expect(await pendingRequestsBetween(A, C)).toBe(1);
  });

  it("two people who unfriend can friend each other again", async () => {
    const X = "refriend-x";
    const Y = "refriend-y";
    await Promise.all([seedUser(X), seedUser(Y)]);

    const first = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", X)
      .send({ toUserId: Y });
    expect(first.status).toBe(200);
    await request(app)
      .post(`/api/users/friend-requests/${first.body.requestId}/accept`)
      .set("x-test-user", Y);
    expect(await friendshipCount(X, Y)).toBe(2);

    await request(app).delete(`/api/users/friends/${Y}`).set("x-test-user", X);
    expect(await friendshipCount(X, Y)).toBe(0);

    const second = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", X)
      .send({ toUserId: Y });
    expect(second.status).toBe(200);
    const accepted = await request(app)
      .post(`/api/users/friend-requests/${second.body.requestId}/accept`)
      .set("x-test-user", Y);
    expect(accepted.status).toBe(200);
    expect(await friendshipCount(X, Y)).toBe(2);
  });

  it("concurrent duplicate requests never create two pending rows", async () => {
    const D = "u08";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post("/api/users/friend-requests")
          .set("x-test-user", A)
          .send({ toUserId: D }),
      ),
    );
    expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    expect(await pendingRequestsBetween(A, D)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 4 — Blocking: what it must sever, and what it must NOT
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-4 — blocking severs the private relationship cleanly", () => {
  const A = "u09";
  const B = "u10";

  beforeAll(async () => {
    await seedSquad("sq-block", A, [A, B, "u11"]);
    await makeFriends(A, B);
  });

  it("blocking drops BOTH friendship rows and closes the DM in both directions", async () => {
    const convo = await storage.getOrCreateDirectConversation(A, B);

    const blocked = await request(app).post(`/api/users/${B}/block`).set("x-test-user", A);
    expect(blocked.status).toBe(200);
    expect(await friendshipCount(A, B)).toBe(0);

    for (const actor of [A, B]) {
      const read = await request(app)
        .get(`/api/conversations/${convo.id}/messages`)
        .set("x-test-user", actor);
      expect(read.status).toBe(403);
    }
    // Neutral copy — the blocked user is never told who blocked whom.
    const send = await request(app)
      .post(`/api/conversations/${convo.id}/messages`)
      .set("x-test-user", B)
      .send({ text: "hello?" });
    expect(send.status).toBe(403);
    expect(JSON.stringify(send.body)).not.toContain("block");
  });

  it("profiles are unreachable in BOTH directions", async () => {
    const asBlocked = await request(app).get(`/api/users/${A}/profile`).set("x-test-user", B);
    const asBlocker = await request(app).get(`/api/users/${B}/profile`).set("x-test-user", A);
    expect(asBlocked.status).toBe(403);
    expect(asBlocker.status).toBe(403);
  });

  it("the shared squad group chat is deliberately UNTOUCHED", async () => {
    const asBlocked = await request(app)
      .get("/api/conversations/squad/sq-block")
      .set("x-test-user", B);
    expect(asBlocked.status).toBe(200);
    const send = await request(app)
      .post(`/api/conversations/${asBlocked.body.id}/messages`)
      .set("x-test-user", B)
      .send({ text: "group message still works" });
    expect(send.status).toBeLessThan(300);
  });

  it("a blocked user cannot send a new friend request", async () => {
    const res = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", B)
      .send({ toUserId: A });
    expect(res.status).toBe(403);
  });

  it("unblocking from Settings restores normal non-friend interaction", async () => {
    const unblocked = await request(app).delete(`/api/users/${B}/block`).set("x-test-user", A);
    expect(unblocked.status).toBe(200);

    // Profile is reachable again…
    const profile = await request(app).get(`/api/users/${A}/profile`).set("x-test-user", B);
    expect(profile.status).toBe(200);

    // …a friend request works again…
    const req2 = await request(app)
      .post("/api/users/friend-requests")
      .set("x-test-user", B)
      .send({ toUserId: A });
    expect(req2.status).toBe(200);

    // …but the DM stays closed until they are friends again.
    const dm = await request(app)
      .post("/api/conversations/direct")
      .set("x-test-user", B)
      .send({ userId: A });
    expect(dm.status).toBe(403);
  });

  it("the block list returns display data inline (Settings can't fan out blocked profiles)", async () => {
    await request(app).post(`/api/users/u12/block`).set("x-test-user", A);
    const list = await request(app).get("/api/users/blocks").set("x-test-user", A);
    expect(list.status).toBe(200);
    expect(list.body.blockedIds).toContain("u12");
    const entry = list.body.blocked.find((b: { id: string }) => b.id === "u12");
    expect(entry).toBeTruthy();
    expect(entry.name).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 5 — Blocking UNDER CONCURRENCY (the freshest, least-tested code)
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-5 — a block placed mid-action wins cleanly (no half-state)", () => {
  it("block racing an incoming friend request leaves no live pending request", async () => {
    // Repeat to cover both interleavings (request-first and block-first).
    for (let i = 0; i < 6; i++) {
      const A = `race-a-${i}`;
      const B = `race-b-${i}`;
      await Promise.all([seedUser(A), seedUser(B)]);

      const [, sendRes] = await Promise.all([
        request(app).post(`/api/users/${B}/block`).set("x-test-user", A),
        request(app)
          .post("/api/users/friend-requests")
          .set("x-test-user", B)
          .send({ toUserId: A }),
      ]);

      // Whatever the interleaving: once the block exists, no pending request
      // may survive — otherwise the blocker sees a request from someone they
      // blocked, and can accept it into a friendship.
      expect([200, 403]).toContain(sendRes.status);
      expect(await pendingRequestsBetween(A, B)).toBe(0);
      expect(await friendshipCount(A, B)).toBe(0);
    }
  });

  it("a pending request that survived a block can NEVER be accepted into a friendship", async () => {
    const A = "stale-blocker";
    const B = "stale-sender";
    await Promise.all([seedUser(A), seedUser(B)]);

    // Reproduce the exact end-state of a lost race: block committed, and a
    // pending request row that the block's cancel pass did not see.
    await dbmod.pool.query(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2)`, [
      A,
      B,
    ]);
    const { rows } = await dbmod.pool.query(
      `INSERT INTO friend_requests (from_user_id, to_user_id, status)
       VALUES ($1,$2,'pending') RETURNING id`,
      [B, A],
    );
    const requestId = rows[0].id;

    const accept = await request(app)
      .post(`/api/users/friend-requests/${requestId}/accept`)
      .set("x-test-user", A);

    expect(accept.status).toBe(403);
    expect(await friendshipCount(A, B)).toBe(0);
  });

  it("block racing a DM open leaves a thread that neither side can use", async () => {
    const A = "dmrace-a";
    const B = "dmrace-b";
    await Promise.all([seedUser(A), seedUser(B)]);
    await makeFriends(A, B);

    const [, openRes] = await Promise.all([
      request(app).post(`/api/users/${B}/block`).set("x-test-user", A),
      request(app).post("/api/conversations/direct").set("x-test-user", B).send({ userId: A }),
    ]);

    expect([201, 403]).toContain(openRes.status);
    if (openRes.status === 201) {
      const send = await request(app)
        .post(`/api/conversations/${openRes.body.id}/messages`)
        .set("x-test-user", B)
        .send({ text: "sneaking in" });
      expect(send.status).toBe(403);
      const read = await request(app)
        .get(`/api/conversations/${openRes.body.id}/messages`)
        .set("x-test-user", B);
      expect(read.status).toBe(403);
    }
    expect(await friendshipCount(A, B)).toBe(0);
  });

  it("simultaneous mutual blocks both land and stay idempotent", async () => {
    const A = "mutual-a";
    const B = "mutual-b";
    await Promise.all([seedUser(A), seedUser(B)]);
    await makeFriends(A, B);

    const results = await Promise.all([
      request(app).post(`/api/users/${B}/block`).set("x-test-user", A),
      request(app).post(`/api/users/${A}/block`).set("x-test-user", B),
      request(app).post(`/api/users/${B}/block`).set("x-test-user", A),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);

    const { rows } = await dbmod.pool.query(
      `SELECT count(*)::int AS c FROM user_blocks
        WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
      [A, B],
    );
    expect(rows[0].c).toBe(2);
    expect(await friendshipCount(A, B)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 6 — Squad lifecycle with an overlapping cohort
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-6 — concurrent joins, leaves and removals across the cohort", () => {
  it("8 simultaneous joins to a public squad all persist", async () => {
    const creator = "u13";
    await seedSquad("sq-rush", creator, [creator], true);
    const joiners = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j8"];
    await Promise.all(joiners.map(seedUser));

    const results = await Promise.all(
      joiners.map((u) =>
        request(app).post("/api/squads/sq-rush/join").set("x-test-user", u).send({}),
      ),
    );
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);

    const members = await squadMemberIds("sq-rush");
    for (const j of joiners) expect(members).toContain(j);
    expect(members).toContain(creator);
  });

  it("a removal racing a leave loses neither write, and the removed member loses chat", async () => {
    const creator = "mix-creator";
    const leaver = "mix-leaver";
    const removed = "mix-removed";
    const stay = "mix-stay";
    await Promise.all([creator, leaver, removed, stay].map(seedUser));
    await seedSquad("sq-mix", creator, [creator, leaver, removed, stay]);

    const convo = await storage.getOrCreateSquadConversation("sq-mix", removed);
    expect(convo).not.toBeNull();

    const [rm, lv] = await Promise.all([
      request(app).delete(`/api/squads/sq-mix/members/${removed}`).set("x-test-user", creator),
      request(app).delete(`/api/squads/sq-mix/members/${leaver}`).set("x-test-user", leaver),
    ]);
    expect(rm.status).toBe(200);
    expect(lv.status).toBe(200);

    const members = await squadMemberIds("sq-mix");
    expect(members.sort()).toEqual([creator, stay].sort());

    // Stale participant row survives by design, but must not grant access.
    expect(await storage.getConversationForMember(convo!.id, removed)).toBeNull();
    const read = await request(app)
      .get(`/api/conversations/${convo!.id}/messages`)
      .set("x-test-user", removed);
    expect(read.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 7 — Plans under concurrent load
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-7 — RSVPs and expenses survive a busy plan", () => {
  it("10 concurrent RSVPs from the cohort all persist", async () => {
    const host = "u14";
    const responders = COHORT.slice(0, 10).filter((u) => u !== host);
    const rsvps: Record<string, string> = { [host]: "going" };
    for (const u of responders) rsvps[u] = "pending";
    await seedEvent("evt-busy", host, { rsvps });

    const statuses = ["going", "maybe", "notgoing"];
    const results = await Promise.all(
      responders.map((u, i) =>
        request(app)
          .post("/api/events/evt-busy/rsvp")
          .set("x-test-user", u)
          .send({ status: statuses[i % statuses.length] }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);

    const final = await eventRsvps("evt-busy");
    responders.forEach((u, i) => expect(final[u]).toBe(statuses[i % statuses.length]));
    expect(final[host]).toBe("going");
  });

  it("concurrent expense adds lose nothing once clients retry the 409", async () => {
    const host = "u15";
    const members = ["u16", "u17"];
    const rsvps: Record<string, string> = { [host]: "going" };
    for (const m of members) rsvps[m] = "going";
    await seedEvent("evt-costs", host, { rsvps });

    const payers = [host, ...members];
    // Each client adds one expense, retrying on 409 exactly like the app does.
    async function addCost(payer: string, amount: number): Promise<number> {
      for (let attempt = 0; attempt < 12; attempt++) {
        const version = await eventVersion("evt-costs");
        const res = await request(app)
          .post("/api/events/evt-costs/costs")
          .set("x-test-user", payer)
          .send({
            description: `Round ${amount}`,
            amount,
            paidById: payer,
            shares: payers.map((p) => ({
              userId: p,
              amount: Number((amount / payers.length).toFixed(2)),
            })),
            version,
          });
        if (res.status < 300) return res.status;
        if (res.status !== 409) return res.status;
        await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
      }
      return 409;
    }

    // 30.00 splits evenly three ways; keeps the cent-exact validator happy.
    const results = await Promise.all(payers.map(() => addCost(payers[0], 30)));
    expect(results.every((s) => s < 300)).toBe(true);
    expect(await eventCosts("evt-costs")).toHaveLength(payers.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 8 — Plan chat after the migration
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-8 — plan chat under concurrent posting", () => {
  const host = "chat-host";
  const members = ["chat-m1", "chat-m2", "chat-m3", "chat-m4"];
  let convoId = "";

  beforeAll(async () => {
    await Promise.all([host, ...members].map(seedUser));
    await seedSquad("sq-planchat", host, [host, ...members]);
    await seedEvent("evt-planchat", host, { squadId: "sq-planchat" });
    const res = await request(app)
      .get("/api/conversations/event/evt-planchat")
      .set("x-test-user", host);
    convoId = res.body.id;
    expect(convoId).toBeTruthy();
  });

  it("concurrent opens converge on ONE thread", async () => {
    const results = await Promise.all(
      members.map((m) =>
        request(app).get("/api/conversations/event/evt-planchat").set("x-test-user", m),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(results.map((r) => r.body.id))).toEqual(new Set([convoId]));
  });

  it("concurrent messages all persist without bumping the event version", async () => {
    const before = await eventVersion("evt-planchat");
    const senders = [host, ...members];
    const results = await Promise.all(
      senders.map((s, i) =>
        request(app)
          .post(`/api/conversations/${convoId}/messages`)
          .set("x-test-user", s)
          .send({ text: `msg from ${s} #${i}` }),
      ),
    );
    expect(results.every((r) => r.status < 300)).toBe(true);

    const read = await request(app)
      .get(`/api/conversations/${convoId}/messages`)
      .set("x-test-user", host);
    expect(read.body.messages.length).toBeGreaterThanOrEqual(senders.length);
    expect(await eventVersion("evt-planchat")).toBe(before);
  });

  it("paginates with a cursor and keeps departed members' messages readable", async () => {
    for (let i = 0; i < 14; i++) {
      await request(app)
        .post(`/api/conversations/${convoId}/messages`)
        .set("x-test-user", members[0])
        .send({ text: `bulk ${i}` });
    }

    const page1 = await request(app)
      .get(`/api/conversations/${convoId}/messages?limit=10`)
      .set("x-test-user", host);
    expect(page1.status).toBe(200);
    expect(page1.body.messages).toHaveLength(10);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`/api/conversations/${convoId}/messages?limit=10&before=${page1.body.nextCursor}`)
      .set("x-test-user", host);
    expect(page2.status).toBe(200);
    expect(page2.body.messages.length).toBeGreaterThan(0);
    const ids1 = new Set(page1.body.messages.map((m: { id: string }) => m.id));
    expect(page2.body.messages.some((m: { id: string }) => ids1.has(m.id))).toBe(false);

    // The prolific member leaves the squad: their history stays, their access goes.
    const removed = await request(app)
      .delete(`/api/squads/sq-planchat/members/${members[0]}`)
      .set("x-test-user", host);
    expect(removed.status).toBe(200);

    const afterRemoval = await request(app)
      .get(`/api/conversations/${convoId}/messages`)
      .set("x-test-user", host);
    expect(afterRemoval.status).toBe(200);
    expect(
      afterRemoval.body.messages.some((m: { senderId: string }) => m.senderId === members[0]),
    ).toBe(true);

    const departed = await request(app)
      .get(`/api/conversations/${convoId}/messages`)
      .set("x-test-user", members[0]);
    expect(departed.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 9 — Free-tier caps under concurrent access
// ═══════════════════════════════════════════════════════════════════════════

describe("SIM-9 — free-tier caps hold when a user fires everything at once", () => {
  it("concurrent plan creates can never exceed the free event limit", async () => {
    const free = "cap-user";
    await seedUser(free);

    const results = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        request(app)
          .post("/api/events")
          .set("x-test-user", free)
          .send({ title: `Cap plan ${i}`, date: "2026-12-31", location: "Anywhere" }),
      ),
    );

    const created = results.filter((r) => r.status < 300).length;
    const refused = results.filter((r) => r.status === 403);
    const { rows } = await dbmod.pool.query(
      `SELECT count(*)::int AS c FROM events WHERE host_id = $1`,
      [free],
    );

    expect(created).toBe(5);
    expect(rows[0].c).toBe(5);
    expect(refused).toHaveLength(4);
    expect(refused.every((r) => r.body.limit === 5)).toBe(true);
  });
});
