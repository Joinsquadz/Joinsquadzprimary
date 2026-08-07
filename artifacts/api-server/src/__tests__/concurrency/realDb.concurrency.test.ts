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
 *       never push a free user past FREE_SQUAD_LIMIT (= 2).
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

const FREE_SQUAD_LIMIT = 2;

let baseDir = "";
let dataDir = "";
let pgStarted = false;
// Loaded dynamically AFTER the env is locked to the local cluster.
let dbmod: typeof import("@workspace/db");
let app: express.Express;

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
function buildApp(eventsRouter: Router, squadsRouter: Router): express.Express {
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
  a.use("/api", eventsRouter);
  a.use("/api", squadsRouter);
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
  app = buildApp(eventsRouter, squadsRouter);
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
): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO events (id, title, date, location, host_id, invite_code, rsvps)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [id, "Test Event", "2026-12-31", "Somewhere", hostId, inviteCode, JSON.stringify(rsvps)],
  );
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
}

async function eventRsvps(id: string): Promise<Record<string, string>> {
  const { rows } = await dbmod.pool.query(`SELECT rsvps FROM events WHERE id = $1`, [id]);
  return (rows[0]?.rsvps ?? {}) as Record<string, string>;
}

async function squadCountFor(userId: string): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT count(*)::int AS c FROM squads WHERE member_ids @> $1::jsonb`,
    [JSON.stringify([userId])],
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
    // Already in 1 squad → exactly ONE more create is allowed (limit = 2).
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
    expect(created).toBe(1);
    expect(blocked).toBe(5);
    expect(await squadCountFor(user)).toBe(FREE_SQUAD_LIMIT);
  });

  it("concurrent JOINs never exceed the free squad limit", async () => {
    const user = "cap-join";
    await seedUser(user);
    await seedSquad("seed-join", [user], false); // already in 1 squad

    const targets = ["pub1", "pub2", "pub3", "pub4", "pub5", "pub6"];
    await Promise.all(targets.map((id) => seedSquad(id, [`owner-${id}`], true)));

    const results = await Promise.all(
      targets.map((id) =>
        request(app).post(`/api/squads/${id}/join`).set("x-test-user", user).send({}),
      ),
    );

    const joined = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 403).length;
    expect(joined).toBe(1);
    expect(blocked).toBe(5);
    expect(await squadCountFor(user)).toBe(FREE_SQUAD_LIMIT);
  });

  it("concurrent JOIN-VIA-CODE never exceeds the free squad limit", async () => {
    const user = "cap-code";
    await seedUser(user);
    await seedSquad("seed-code", [user], false); // already in 1 squad

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
    expect(joined).toBe(1);
    expect(blocked).toBe(5);
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
