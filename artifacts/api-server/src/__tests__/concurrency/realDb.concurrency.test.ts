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
 * SECTION 4 — Multi-User Simulation (isolated concurrency integration test).
 *
 * This is the *real-database* counterpart to the mocked unit tests. It boots a
 * throwaway local Postgres 16 cluster (initdb + pg_ctl on 127.0.0.1), applies
 * the live Drizzle schema, and then fires genuinely concurrent HTTP requests at
 * the real route handlers to prove the SECTION-4 fixes hold under contention:
 *
 *   A1  POST /events/:id/rsvp  — concurrent RSVPs from different users all
 *       persist (atomic per-user `||` merge, no lost updates, no spurious 409).
 *   A2  POST /events/join      — concurrent invite-code joins all persist.
 *   E1  POST /squads + /squads/:id/join — the free-plan squad cap is enforced
 *       atomically (advisory-lock re-count), so concurrent creates/joins can
 *       never push a free user past FREE_SQUAD_LIMIT (= 3).
 *
 * SAFETY: this test refuses to run against any Supabase/remote database. It
 * deletes every Supabase env var, points DATABASE_URL exclusively at the
 * ephemeral 127.0.0.1 cluster, and hard-asserts that invariant before importing
 * the db singleton. The prod Supabase database is never touched.
 *
 * It is intentionally excluded from the default unit suite (see
 * vitest.config.ts) and runs via `pnpm --filter @workspace/api-server run
 * test:concurrency`.
 */

const FREE_SQUAD_LIMIT = 3;

let baseDir = "";
let dataDir = "";
let pgStarted = false;
// Loaded dynamically AFTER the env is locked to the local cluster.
let dbmod: typeof import("@workspace/db");
let app: express.Express;
// Also loaded dynamically after the env lock — used for the chat-access checks,
// which live in storage rather than behind an HTTP route.
let storage: typeof import("../../storage").storage;

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

// Header-based auth shim: each supertest request carries `x-test-user`, so a
// single app instance can act as many distinct concurrent users. requireAuth
// only checks req.isAuthenticated(), which this satisfies.
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
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "squadz-pg-"));
  dataDir = path.join(baseDir, "data");
  const sockDir = path.join(baseDir, "sock");
  fs.mkdirSync(sockDir);
  const logFile = path.join(baseDir, "pg.log");
  const port = await getFreePort();

  // 1) Spin up a throwaway Postgres cluster on loopback only.
  execFileSync("initdb", ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"], {
    stdio: "pipe",
  });
  execFileSync(
    "pg_ctl",
    ["-D", dataDir, "-l", logFile, "-o", `-p ${port} -h 127.0.0.1 -k ${sockDir}`, "-w", "start"],
    { stdio: "pipe" },
  );
  pgStarted = true;

  // 2) Lock the environment to the local cluster and PROVE we can't reach prod.
  //    Also clear DB_POOLER_PORT: resolveDbConfig() applies it as a port override
  //    AFTER parsing DATABASE_URL, so leaving it set would redirect the pool to
  //    port 6543 instead of the ephemeral cluster's random port → ECONNREFUSED.
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

  // 3) Generate the live schema SQL (offline, no DB connection) and apply it.
  const dbPkgDir = path.resolve(process.cwd(), "../../lib/db");
  const drizzleBin = path.join(dbPkgDir, "node_modules/.bin/drizzle-kit");
  const outDir = path.join(baseDir, "drizzle");
  execFileSync(
    drizzleBin,
    ["generate", "--dialect", "postgresql", "--schema", "./src/schema/index.ts", "--out", outDir],
    { cwd: dbPkgDir, stdio: "pipe" },
  );

  // 4) Import the db singleton AFTER the env is locked, then apply the schema.
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

  // 5) Build the app against the real handlers.
  const eventsRouter = (await import("../../routes/events")).default;
  const squadsRouter = (await import("../../routes/squads")).default;
  const availabilityRouter = (await import("../../routes/availability")).default;
  app = buildApp(eventsRouter, squadsRouter, availabilityRouter);
  storage = (await import("../../storage")).storage;
}, 120_000);

afterAll(async () => {
  // Let any fire-and-forget push tasks settle before closing the pool.
  await new Promise((r) => setTimeout(r, 250));
  try {
    await dbmod?.pool?.end();
  } catch {
    // ignore — pool may already be closing
  }
  if (pgStarted) {
    try {
      execFileSync("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"], { stdio: "pipe" });
    } catch {
      // ignore stop errors during teardown
    }
  }
  if (baseDir) {
    try {
      fs.rmSync(baseDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ── Seed helpers (raw SQL via the shared pool) ───────────────────────────────

async function seedUser(id: string): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.test`],
  );
}

async function seedEvent(
  id: string,
  hostId: string,
  rsvps: Record<string, string>,
  inviteCode: string,
  extra?: { polls?: unknown[]; costs?: unknown[] },
): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO events (id, title, date, location, host_id, invite_code, rsvps, polls, costs, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, 0)`,
    [
      id, "Test Event", "2026-12-31", "Somewhere", hostId, inviteCode,
      JSON.stringify(rsvps),
      JSON.stringify(extra?.polls ?? []),
      JSON.stringify(extra?.costs ?? []),
    ],
  );
}

async function eventVersion(id: string): Promise<number> {
  const { rows } = await dbmod.pool.query(`SELECT version FROM events WHERE id = $1`, [id]);
  return rows[0]?.version ?? 0;
}

async function eventCosts(id: string): Promise<unknown[]> {
  const { rows } = await dbmod.pool.query(`SELECT costs FROM events WHERE id = $1`, [id]);
  return (rows[0]?.costs ?? []) as unknown[];
}

async function seedSquad(
  id: string,
  memberIds: string[],
  isPublic: boolean,
  code?: string,
): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO squads (id, name, member_ids, is_public, invite_code)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [id, `Squad ${id}`, JSON.stringify(memberIds), isPublic, code ?? `CODE-${id}`],
  );
  // #633: the free cap counts the append-only history ledger, not live
  // member_ids, so a seeded membership only counts if its history row exists.
  for (const userId of memberIds) {
    await dbmod.pool.query(
      `INSERT INTO squad_member_history (squad_id, user_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, userId],
    );
  }
}

async function eventRsvps(id: string): Promise<Record<string, string>> {
  const { rows } = await dbmod.pool.query(`SELECT rsvps FROM events WHERE id = $1`, [id]);
  return (rows[0]?.rsvps ?? {}) as Record<string, string>;
}

async function squadCountFor(userId: string): Promise<number> {
  // #633: slots consumed = append-only history rows (what withSquadLimit
  // counts), not live memberships.
  const { rows } = await dbmod.pool.query(
    `SELECT count(*)::int AS c FROM squad_member_history WHERE user_id = $1`,
    [userId],
  );
  return rows[0]?.c ?? 0;
}

async function seedFoundingCounter(redeemed: number): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO founding_member_counter (id, redeemed) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET redeemed = EXCLUDED.redeemed`,
    [redeemed],
  );
}

async function foundingRedeemed(): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT redeemed FROM founding_member_counter WHERE id = 1`,
  );
  return rows[0]?.redeemed ?? 0;
}

// ── A1: concurrent RSVPs merge per-user (no lost updates) ─────────────────────

describe("A1 — concurrent RSVPs persist per user", () => {
  it("6 simultaneous RSVPs from different users all succeed and all persist", async () => {
    const host = "rsvp-host";
    const users = ["ru1", "ru2", "ru3", "ru4", "ru5", "ru6"];
    await seedUser(host);
    await Promise.all(users.map(seedUser));
    // Pre-populate rsvps so every responder passes the membership gate.
    const initial: Record<string, string> = { [host]: "going" };
    for (const u of users) initial[u] = "pending";
    await seedEvent("evt-rsvp", host, initial, "RSVPCODE1");

    const statuses = ["going", "maybe", "notgoing", "going", "maybe", "notgoing"];
    const results = await Promise.all(
      users.map((u, i) =>
        request(app)
          .post("/api/events/evt-rsvp/rsvp")
          .set("x-test-user", u)
          .send({ status: statuses[i] }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.conflict).toBeUndefined();
    }
    const finalRsvps = await eventRsvps("evt-rsvp");
    users.forEach((u, i) => {
      expect(finalRsvps[u]).toBe(statuses[i]);
    });
    // Host's pre-existing key must survive the concurrent merges.
    expect(finalRsvps[host]).toBe("going");
  });
});

// ── A2: concurrent invite-code joins all persist ─────────────────────────────

describe("A2 — concurrent event joins persist", () => {
  it("5 simultaneous /events/join by invite code all land in rsvps", async () => {
    const host = "join-host";
    const joiners = ["ej1", "ej2", "ej3", "ej4", "ej5"];
    await seedUser(host);
    await Promise.all(joiners.map(seedUser));
    await seedEvent("evt-join", host, { [host]: "going" }, "JOINCODE1");

    const results = await Promise.all(
      joiners.map((u) =>
        request(app).post("/api/events/join").set("x-test-user", u).send({ inviteCode: "JOINCODE1" }),
      ),
    );

    for (const res of results) {
      expect(res.status).toBe(200);
    }
    const finalRsvps = await eventRsvps("evt-join");
    for (const u of joiners) {
      expect(finalRsvps[u]).toBe("going");
    }
    expect(finalRsvps[host]).toBe("going");
  });
});

// ── E1: free-plan squad cap is enforced atomically ───────────────────────────

describe("E1 — squad cap holds under concurrency", () => {
  it("concurrent CREATEs never exceed the free squad limit", async () => {
    const user = "cap-create";
    await seedUser(user);
    // Already in 1 squad → exactly TWO more creates are allowed (limit = 3).
    await seedSquad("seed-create", [user], false);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post("/api/squads")
          .set("x-test-user", user)
          .send({ name: `Concurrent ${i}`, memberIds: [] }),
      ),
    );

    const created = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 403).length;
    expect(created).toBe(2);
    expect(blocked).toBe(4);
    expect(await squadCountFor(user)).toBe(FREE_SQUAD_LIMIT);
  });

  it("concurrent JOINs never exceed the free squad limit", async () => {
    const user = "cap-join";
    await seedUser(user);
    await seedSquad("seed-join", [user], false); // already in 1 squad (limit = 3)

    const targets = ["pub1", "pub2", "pub3", "pub4", "pub5", "pub6"];
    await Promise.all(targets.map((id) => seedSquad(id, [`owner-${id}`], true)));

    const results = await Promise.all(
      targets.map((id) =>
        request(app).post(`/api/squads/${id}/join`).set("x-test-user", user).send({}),
      ),
    );

    const joined = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 403).length;
    expect(joined).toBe(2);
    expect(blocked).toBe(4);
    expect(await squadCountFor(user)).toBe(FREE_SQUAD_LIMIT);
  });

  it("concurrent JOIN-VIA-CODE never exceeds the free squad limit", async () => {
    const user = "cap-code";
    await seedUser(user);
    await seedSquad("seed-code", [user], false); // already in 1 squad (limit = 3)

    // Invite codes are matched after trim().toUpperCase(), so seed them uppercase.
    const codes = ["JVC1", "JVC2", "JVC3", "JVC4", "JVC5", "JVC6"];
    await Promise.all(codes.map((c) => seedSquad(`sq-${c}`, [`owner-${c}`], false, c)));

    const results = await Promise.all(
      codes.map((c) =>
        request(app).post("/api/squads/join-via-code").set("x-test-user", user).send({ code: c }),
      ),
    );

    const joined = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 403).length;
    expect(joined).toBe(2);
    expect(blocked).toBe(4);
    expect(await squadCountFor(user)).toBe(FREE_SQUAD_LIMIT);
  });
});

// ── F1: founding spot is consumed at PAYMENT, idempotently ───────────────────
//
// New model: the tier shown at checkout creation is a read-only decision (it
// does NOT consume a spot), and the counter is only incremented from the
// checkout.session.completed webhook via redeemFoundingSpot — idempotent per
// subscription id. These tests prove both halves hold under real concurrency.

describe("F1 — decideCheckoutTier is read-only (no spot burned at checkout start)", () => {
  it("at 499/500, ALL concurrent decisions get 'founding' and the counter is untouched", async () => {
    const { decideCheckoutTier, FOUNDING_MEMBER_LIMIT } = await import("../../lib/founding");
    await seedFoundingCounter(FOUNDING_MEMBER_LIMIT - 1); // one spot left

    const results = await Promise.all(
      Array.from({ length: 8 }, () => decideCheckoutTier()),
    );

    // Nothing is claimed at checkout start, so concurrent shoppers can all be
    // offered the founding price — whoever actually pays consumes the spot.
    expect(results.every((t) => t === "founding")).toBe(true);
    expect(await foundingRedeemed()).toBe(FOUNDING_MEMBER_LIMIT - 1);
  });

  it("when sold out, every decision is 'standard' and the counter is unchanged", async () => {
    const { decideCheckoutTier, FOUNDING_MEMBER_LIMIT } = await import("../../lib/founding");
    await seedFoundingCounter(FOUNDING_MEMBER_LIMIT);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => decideCheckoutTier()),
    );

    expect(results.every((t) => t === "standard")).toBe(true);
    expect(await foundingRedeemed()).toBe(FOUNDING_MEMBER_LIMIT);
  });
});

describe("F1 — redeemFoundingSpot consumes a spot at payment, idempotently", () => {
  it("N distinct paid subscriptions consume exactly N spots under concurrency", async () => {
    const { redeemFoundingSpot } = await import("../../lib/founding");
    await seedFoundingCounter(10);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => redeemFoundingSpot(`sub_distinct_${i}`)),
    );

    expect(results.filter(Boolean).length).toBe(6);
    expect(await foundingRedeemed()).toBe(16);
  });

  it("re-delivering the same subscription only ever consumes ONE spot", async () => {
    const { redeemFoundingSpot } = await import("../../lib/founding");
    await seedFoundingCounter(0);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => redeemFoundingSpot("sub_idempotent")),
    );

    // Exactly one call wins the ledger insert; the rest are no-ops.
    expect(results.filter(Boolean).length).toBe(1);
    expect(await foundingRedeemed()).toBe(1);

    // A later re-delivery (sequential) is still a no-op.
    expect(await redeemFoundingSpot("sub_idempotent")).toBe(false);
    expect(await foundingRedeemed()).toBe(1);
  });
});

// ── B9: last-spot race — exactly one concurrent winner ────────────────────────
//
// When the founding counter is one below the cap (499/500) and multiple
// concurrent webhooks try to claim the final spot, the advisory-lock
// transaction guarantees exactly ONE winner. The counter must land at exactly
// FOUNDING_MEMBER_LIMIT — no over-redemption — and all subsequent tier
// decisions must fall through to the $29.99 standard price.

describe("B9 — founding-spot race: only one concurrent winner at the cap", () => {
  it("exactly one of N concurrent attempts claims the last spot; counter lands at the limit", async () => {
    const { redeemFoundingSpot, FOUNDING_MEMBER_LIMIT } = await import("../../lib/founding");
    // One spot left — the classic sold-out race.
    await seedFoundingCounter(FOUNDING_MEMBER_LIMIT - 1);

    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => redeemFoundingSpot(`sub_race_b9_${i}`)),
    );

    // Exactly ONE call wins — the advisory-lock serialises the increment.
    const winners = results.filter(Boolean);
    expect(winners.length).toBe(1);

    // Counter must be exactly at the cap — no over-redemption.
    expect(await foundingRedeemed()).toBe(FOUNDING_MEMBER_LIMIT);
  });

  it("decideCheckoutTier returns 'standard' after the last spot is taken (sold-out fallthrough)", async () => {
    const { redeemFoundingSpot, decideCheckoutTier, FOUNDING_MEMBER_LIMIT } =
      await import("../../lib/founding");
    await seedFoundingCounter(FOUNDING_MEMBER_LIMIT - 1);

    // Claim the final spot.
    await redeemFoundingSpot("sub_last_spot");
    expect(await foundingRedeemed()).toBe(FOUNDING_MEMBER_LIMIT);

    // Any subsequent checkout decision must now see 'standard' ($29.99 path).
    const tier = await decideCheckoutTier();
    expect(tier).toBe("standard");
  });

  it("the losing concurrent attempts all return false (no phantom redemptions)", async () => {
    const { redeemFoundingSpot, FOUNDING_MEMBER_LIMIT } = await import("../../lib/founding");
    await seedFoundingCounter(FOUNDING_MEMBER_LIMIT - 1);

    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => redeemFoundingSpot(`sub_loser_${i}`)),
    );

    const losers = results.filter((r) => !r);
    // N - 1 attempts must have received the sold-out (false) result.
    expect(losers.length).toBe(N - 1);
  });
});

// ── C1: concurrent cost adds — only the first writer at version N wins ────────
//
// Two or more members submit a cost at the same moment, both carrying version=N
// in their request body. The compare-and-swap WHERE clause (version = N)
// serialises them at the DB level: the first UPDATE bumps version to N+1 and
// returns the updated row; every subsequent UPDATE finds no matching row
// (version is now N+1) and gets 0 rows back → 409 Conflict. The final costs
// array must contain exactly one new expense.

describe("C1 — concurrent cost adds: only one write wins per version", () => {
  it("5 concurrent cost adds at version 0: exactly 1 succeeds and 4 get 409", async () => {
    const host = "cost-host";
    await seedUser(host);
    await seedEvent("evt-cost", host, { [host]: "going" }, "COSTCODE1");

    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        request(app)
          .post("/api/events/evt-cost/costs")
          .set("x-test-user", host)
          .send({
            description: `Concurrent expense ${i}`,
            amount: 10,
            paidById: host,
            shares: [{ userId: host, amount: 10 }],
            version: 0, // all carry the same base version
          }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded.length).toBe(1);
    expect(conflicted.length).toBe(N - 1);
    conflicted.forEach((r) => expect(r.body.conflict).toBe(true));

    // The DB must contain exactly one cost entry (no lost-update ghost writes).
    const costs = await eventCosts("evt-cost");
    expect(costs.length).toBe(1);

    // Version must be exactly 1 — a single compare-and-swap won.
    expect(await eventVersion("evt-cost")).toBe(1);
  });
});

// ── P1: concurrent poll votes — only the first voter at version N wins ────────
//
// Multiple members vote on the same poll at the same moment, all supplying
// version=N. The same compare-and-swap guarantee applies: exactly one vote is
// persisted per concurrent batch, the rest receive 409 Conflict. The voter can
// retry with the refreshed version (N+1) and will then succeed.

describe("P1 — concurrent poll votes: only one write wins per version", () => {
  it("5 concurrent votes at version 0: exactly 1 succeeds and 4 get 409", async () => {
    const host = "vote-host";
    const voters = ["vv1", "vv2", "vv3", "vv4", "vv5"];
    await seedUser(host);
    await Promise.all(voters.map(seedUser));

    const poll = {
      id: "poll-race",
      question: "Tacos or Burritos?",
      options: [
        { id: "opt-tacos", label: "Tacos", voterIds: [] },
        { id: "opt-burritos", label: "Burritos", voterIds: [] },
      ],
    };
    // Pre-populate rsvps so all voters pass the membership gate.
    const rsvps: Record<string, string> = { [host]: "going" };
    for (const v of voters) rsvps[v] = "going";
    await seedEvent("evt-vote", host, rsvps, "VOTECODE1", { polls: [poll] });

    const results = await Promise.all(
      voters.map((u) =>
        request(app)
          .post("/api/events/evt-vote/polls/poll-race/vote")
          .set("x-test-user", u)
          .send({ optionId: "opt-tacos", version: 0 }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const conflicted = results.filter((r) => r.status === 409);
    expect(succeeded.length).toBe(1);
    expect(conflicted.length).toBe(voters.length - 1);
    conflicted.forEach((r) => expect(r.body.conflict).toBe(true));

    // Version must be exactly 1 — one CAS write won.
    expect(await eventVersion("evt-vote")).toBe(1);
  });
});

// ── Seed helpers for the SECTION-5 fixes ─────────────────────────────────────

async function seedPoll(
  id: string,
  createdBy: string,
  scope: { squadId?: string; eventId?: string },
): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO availability_polls (id, squad_id, event_id, created_by, days, slots)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      id,
      scope.squadId ?? null,
      scope.eventId ?? null,
      createdBy,
      JSON.stringify(["2026-12-30", "2026-12-31"]),
      JSON.stringify(["6PM", "7PM"]),
    ],
  );
}

async function squadMemberIds(id: string): Promise<string[]> {
  const { rows } = await dbmod.pool.query(`SELECT member_ids FROM squads WHERE id = $1`, [id]);
  return (rows[0]?.member_ids ?? []) as string[];
}

async function squadExists(id: string): Promise<boolean> {
  const { rows } = await dbmod.pool.query(`SELECT 1 FROM squads WHERE id = $1`, [id]);
  return rows.length > 0;
}

async function nudgeRows(pollId: string): Promise<{ from_user_id: string; sent_at: Date }[]> {
  const { rows } = await dbmod.pool.query(
    `SELECT from_user_id, sent_at FROM availability_nudges WHERE poll_id = $1`,
    [pollId],
  );
  return rows;
}

async function pollConvertedEventId(id: string): Promise<string | null> {
  const { rows } = await dbmod.pool.query(
    `SELECT converted_event_id FROM availability_polls WHERE id = $1`,
    [id],
  );
  return rows[0]?.converted_event_id ?? null;
}

async function eventsForHost(hostId: string): Promise<string[]> {
  const { rows } = await dbmod.pool.query(`SELECT id FROM events WHERE host_id = $1`, [hostId]);
  return rows.map((r: { id: string }) => r.id);
}

// ── S1: concurrent member removals never resurrect a removed member ──────────
//
// The old route read memberIds, filtered out one id, and wrote the whole array
// back unconditionally. Two managers removing two different members at the same
// instant each wrote their own stale snapshot, so the second write silently
// restored the member the first had just removed. The version-guarded CAS makes
// the loser re-read and retry instead.

describe("S1 — concurrent squad member removals don't lose each other", () => {
  it("two simultaneous removals both stick (no resurrected member)", async () => {
    const creator = "rm-creator";
    const a = "rm-member-a";
    const b = "rm-member-b";
    const keep = "rm-member-keep";
    await Promise.all([creator, a, b, keep].map(seedUser));
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, false, $5)`,
      ["sq-rm", "Removal Squad", creator, JSON.stringify([creator, a, b, keep]), "RMCODE1"],
    );

    const [resA, resB] = await Promise.all([
      request(app).delete(`/api/squads/sq-rm/members/${a}`).set("x-test-user", creator),
      request(app).delete(`/api/squads/sq-rm/members/${b}`).set("x-test-user", creator),
    ]);

    // Both are legitimate removals by the creator: both must succeed (the CAS
    // retry absorbs the collision) — a 409 here would mean we gave up too early.
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const members = await squadMemberIds("sq-rm");
    expect(members).not.toContain(a);
    expect(members).not.toContain(b);
    expect(members).toEqual(expect.arrayContaining([creator, keep]));
    expect(members).toHaveLength(2);
  });

  it("a removal racing a join keeps the joiner (no lost update)", async () => {
    const creator = "rmj-creator";
    const target = "rmj-target";
    const joiner = "rmj-joiner";
    await Promise.all([creator, target, joiner].map(seedUser));
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, true, $5)`,
      ["sq-rmj", "Race Squad", creator, JSON.stringify([creator, target]), "RMJCODE1"],
    );

    const [removal, join] = await Promise.all([
      request(app).delete(`/api/squads/sq-rmj/members/${target}`).set("x-test-user", creator),
      request(app).post("/api/squads/sq-rmj/join").set("x-test-user", joiner).send({}),
    ]);

    expect(removal.status).toBe(200);
    expect(join.status).toBe(201);

    const members = await squadMemberIds("sq-rmj");
    // The removal must not have written back a snapshot that predates the join.
    expect(members).toContain(joiner);
    expect(members).not.toContain(target);
    expect(members).toContain(creator);
  });

  it("the last member leaving still deletes the squad exactly once", async () => {
    const solo = "rm-solo";
    await seedUser(solo);
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, false, $5)`,
      ["sq-solo", "Solo Squad", solo, JSON.stringify([solo]), "SOLOCODE"],
    );

    const res = await request(app)
      .delete(`/api/squads/sq-solo/members/${solo}`)
      .set("x-test-user", solo);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(await squadExists("sq-solo")).toBe(false);
  });

  // The teardown is the nastiest window: the last member leaves (squad gets
  // purged and deleted) while a stranger joins the public squad. If the claim
  // is a standalone statement, the join can commit between the claim and the
  // DELETE — and the joiner's brand-new squad is purged out from under them.
  // Claim + purge + delete share one transaction, so the claim's row lock is
  // held for the whole teardown and the join can only land strictly before or
  // strictly after it. Repeated to actually hit both interleavings.
  it("a solo teardown never deletes a squad someone just joined", async () => {
    for (let i = 0; i < 5; i++) {
      const solo = `tj-solo-${i}`;
      const joiner = `tj-joiner-${i}`;
      const squadId = `sq-tj-${i}`;
      await Promise.all([solo, joiner].map(seedUser));
      await dbmod.pool.query(
        `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
         VALUES ($1, $2, $3, $4::jsonb, true, $5)`,
        [squadId, "Teardown Race", solo, JSON.stringify([solo]), `TJCODE${i}`],
      );

      const [leave, join] = await Promise.all([
        request(app).delete(`/api/squads/${squadId}/members/${solo}`).set("x-test-user", solo),
        request(app).post(`/api/squads/${squadId}/join`).set("x-test-user", joiner).send({}),
      ]);

      if (await squadExists(squadId)) {
        // The join won the row: the squad survives BECAUSE it has a member.
        const members = await squadMemberIds(squadId);
        expect(join.status).toBe(201);
        expect(members).toContain(joiner);
        // The leave then re-read fresh state and ran as an ordinary removal
        // (or gave up with a conflict) — never as a teardown.
        expect([200, 409]).toContain(leave.status);
        if (leave.status === 200) {
          expect(leave.body.deleted).toBeUndefined();
          expect(members).not.toContain(solo);
        }
      } else {
        // The teardown won: the squad is gone, so the join must NOT report
        // that it joined, and must leave no membership behind.
        expect(leave.status).toBe(200);
        expect(leave.body.deleted).toBe(true);
        expect(join.status).not.toBe(201);
        expect(await squadCountFor(joiner)).toBe(0);
      }
    }
  });
});

// ── S2: a removed member loses chat access even though their participant row
//        is still there ───────────────────────────────────────────────────────
//
// Squad conversation participant rows are append-only (they're kept so old
// messages still resolve an author). Access therefore MUST be decided from the
// CURRENT squad membership, never from the presence of a participant row.

describe("S2 — removal revokes squad chat access despite the stale participant row", () => {
  it("getConversationForMember returns null after removal, participant row intact", async () => {
    const creator = "chat-creator";
    const member = "chat-member";
    await Promise.all([creator, member].map(seedUser));
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, false, $5)`,
      ["sq-chat", "Chat Squad", creator, JSON.stringify([creator, member]), "CHATCODE"],
    );

    // Both users open the squad chat, which materializes participant rows.
    const convo = await storage.getOrCreateSquadConversation("sq-chat", creator);
    expect(convo).not.toBeNull();
    const convoId = convo!.id;
    expect(await storage.getConversationForMember(convoId, member)).not.toBeNull();

    const res = await request(app)
      .delete(`/api/squads/sq-chat/members/${member}`)
      .set("x-test-user", creator);
    expect(res.status).toBe(200);

    // The row is deliberately still there…
    const { rows } = await dbmod.pool.query(
      `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
      [convoId, member],
    );
    expect(rows.length).toBe(1);
    // …but it must not grant access any more.
    expect(await storage.getConversationForMember(convoId, member)).toBeNull();
    // The remaining member is unaffected.
    expect(await storage.getConversationForMember(convoId, creator)).not.toBeNull();
  });
});

// ── S3: nudge debounce is atomic ─────────────────────────────────────────────
//
// The old flow was read-then-insert: getRecentNudge() and then createNudge().
// Simultaneous taps both passed the read, and the second INSERT hit the
// (poll_id, to_user_id) unique constraint → 500. The upsert collapses the
// check and the write into one statement.

describe("S3 — concurrent nudges debounce atomically", () => {
  it("6 simultaneous nudges send exactly one and 429 the rest (never 500)", async () => {
    const creator = "nudge-creator";
    const target = "nudge-target";
    await Promise.all([creator, target].map(seedUser));
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, false, $5)`,
      ["sq-nudge", "Nudge Squad", creator, JSON.stringify([creator, target]), "NDGCODE1"],
    );
    await seedPoll("poll-nudge", creator, { squadId: "sq-nudge" });

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        request(app)
          .post("/api/availability/polls/poll-nudge/nudge")
          .set("x-test-user", creator)
          .send({ targetUserId: target }),
      ),
    );

    const ok = results.filter((r) => r.status === 200);
    const throttled = results.filter((r) => r.status === 429);
    const failed = results.filter((r) => r.status >= 500);
    expect(failed).toHaveLength(0); // the unique violation must never surface
    expect(ok).toHaveLength(1);
    expect(throttled).toHaveLength(5);
    throttled.forEach((r) => expect(r.body.debounced).toBe(true));

    // Exactly one nudge row for this (poll, target) — the constraint holds and
    // the debounce didn't duplicate the push.
    expect(await nudgeRows("poll-nudge")).toHaveLength(1);
  });

  it("a nudge outside the window replaces the old row instead of erroring", async () => {
    const creator = "nudge2-creator";
    const target = "nudge2-target";
    await Promise.all([creator, target].map(seedUser));
    await dbmod.pool.query(
      `INSERT INTO squads (id, name, creator_id, member_ids, is_public, invite_code)
       VALUES ($1, $2, $3, $4::jsonb, false, $5)`,
      ["sq-nudge2", "Nudge Squad 2", creator, JSON.stringify([creator, target]), "NDGCODE2"],
    );
    await seedPoll("poll-nudge2", creator, { squadId: "sq-nudge2" });
    // An old nudge, well outside the 5-minute debounce window.
    await dbmod.pool.query(
      `INSERT INTO availability_nudges (poll_id, from_user_id, to_user_id, sent_at)
       VALUES ($1, $2, $3, now() - interval '2 hours')`,
      ["poll-nudge2", creator, target],
    );

    const res = await request(app)
      .post("/api/availability/polls/poll-nudge2/nudge")
      .set("x-test-user", creator)
      .send({ targetUserId: target });

    // Pre-fix this was a 500 from the unique constraint: the window had expired
    // but the row still existed, so the plain INSERT always blew up.
    expect(res.status).toBe(200);
    const rows = await nudgeRows("poll-nudge2");
    expect(rows).toHaveLength(1);
    expect(Date.now() - new Date(rows[0].sent_at).getTime()).toBeLessThan(60_000);
  });
});

// ── S4: poll → plan conversion is exactly-once ───────────────────────────────
//
// Claiming the poll AFTER creating the event could only ever re-stamp it: by
// then a double-tap had already produced two plans. The claim now happens
// inside the create transaction, so the losing request's event is rolled back
// and the caller is handed the plan that won.

describe("S4 — converting a poll into a plan is exactly-once", () => {
  it("6 simultaneous creates from one poll produce exactly ONE event", async () => {
    const creator = "conv-creator";
    await seedUser(creator);
    await seedPoll("poll-conv", creator, {});

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request(app)
          .post("/api/events")
          .set("x-test-user", creator)
          .send({
            title: `Locked in ${i}`,
            date: "Dec 31",
            location: "Somewhere",
            sourcePollId: "poll-conv",
          }),
      ),
    );

    // Nobody gets an error — the losers are handed the winning plan.
    for (const r of results) expect([200, 201]).toContain(r.status);
    const created = results.filter((r) => r.status === 201);
    const deduped = results.filter((r) => r.status === 200);
    expect(created).toHaveLength(1);
    expect(deduped).toHaveLength(5);
    deduped.forEach((r) => expect(r.body.alreadyConverted).toBe(true));

    // One event, and everyone was pointed at that same id.
    const hostEvents = await eventsForHost(creator);
    expect(hostEvents).toHaveLength(1);
    const winningId = created[0].body.id;
    expect(hostEvents[0]).toBe(winningId);
    for (const r of results) expect(r.body.id).toBe(winningId);
    expect(await pollConvertedEventId("poll-conv")).toBe(winningId);
  });

  it("the rolled-back losers leave no ledger rows behind", async () => {
    const creator = "conv-ledger";
    await seedUser(creator);
    await seedPoll("poll-ledger", creator, {});

    await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app)
          .post("/api/events")
          .set("x-test-user", creator)
          .send({ title: "Ledger", date: "Dec 31", location: "X", sourcePollId: "poll-ledger" }),
      ),
    );

    // The event-cap ledger must not be charged for events that never existed.
    const { rows } = await dbmod.pool.query(
      `SELECT count(*)::int AS c FROM event_creations WHERE user_id = $1`,
      [creator],
    );
    expect(rows[0].c).toBe(1);
  });

  it("a second poll conversion to a DIFFERENT event is refused (409)", async () => {
    const creator = "conv-second";
    await seedUser(creator);
    await seedPoll("poll-second", creator, {});
    await seedEvent("evt-first", creator, { [creator]: "going" }, "CONVCODE1");
    await seedEvent("evt-other", creator, { [creator]: "going" }, "CONVCODE2");

    const first = await request(app)
      .post("/api/availability/polls/poll-second/convert")
      .set("x-test-user", creator)
      .send({ eventId: "evt-first" });
    expect(first.status).toBe(200);

    // Idempotent retry with the SAME id still succeeds.
    const retry = await request(app)
      .post("/api/availability/polls/poll-second/convert")
      .set("x-test-user", creator)
      .send({ eventId: "evt-first" });
    expect(retry.status).toBe(200);

    // A different plan cannot steal the conversion.
    const second = await request(app)
      .post("/api/availability/polls/poll-second/convert")
      .set("x-test-user", creator)
      .send({ eventId: "evt-other" });
    expect(second.status).toBe(409);
    expect(second.body.convertedEventId).toBe("evt-first");
    expect(await pollConvertedEventId("poll-second")).toBe("evt-first");
  });
});
