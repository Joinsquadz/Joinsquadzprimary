import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Real-database regression guard for PLAN (event / trip) CHAT THREADS.
 *
 * Plan chat used to be an array on `events.messages`: unpaginated, version-
 * bumping, and read-tracked only on the client. It now lives in a conversation
 * thread keyed by a unique `conversations.event_id`. The invariants that can
 * only be proven against a real Postgres are:
 *
 *   1. EXACTLY ONE thread per plan, even when many members open the chat at the
 *      same instant (unique index + ON CONFLICT + re-read, no duplicate rows).
 *   2. The legacy backfill is IDEMPOTENT and ORDER-PRESERVING, and it drains
 *      the JSON column so a re-run is a no-op (deterministic message ids).
 *   3. Access is re-derived from CURRENT plan visibility on every read, so a
 *      removed squadmate loses the thread even though their participant row
 *      (deliberately append-only) survives.
 *   4. Sending a chat message NEVER bumps the parent event's `version` — the
 *      whole reason chat was moved off the event record.
 *
 * Like the rest of this directory, it boots a throwaway local Postgres and
 * refuses to run against any remote/Supabase database. Excluded from the
 * default unit run; runs via `pnpm --filter @workspace/api-server run
 * test:concurrency`.
 */

let baseDir = "";
let dataDir = "";
let pgStarted = false;
let dbmod: typeof import("@workspace/db");
let storage: typeof import("../../storage").storage;
let migrateEmbeddedEventMessages: typeof import("../../lib/eventChatMigration").migrateEmbeddedEventMessages;

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

beforeAll(async () => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "squadz-plchat-pg-"));
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

  // Lock the environment to the local cluster and PROVE we can't reach prod.
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

  // Generate the live schema SQL (offline) and apply it.
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

  // Import the singletons AFTER the env is locked to the local cluster.
  storage = (await import("../../storage")).storage;
  migrateEmbeddedEventMessages = (await import("../../lib/eventChatMigration"))
    .migrateEmbeddedEventMessages;
}, 120_000);

afterAll(async () => {
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

async function seedUser(id: string): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [id, `${id}@example.test`],
  );
}

async function seedSquad(id: string, memberIds: string[]): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO squads (id, name, member_ids, is_public, invite_code)
     VALUES ($1, $2, $3::jsonb, false, $4)
     ON CONFLICT (id) DO UPDATE SET member_ids = EXCLUDED.member_ids`,
    [id, `Squad ${id}`, JSON.stringify(memberIds), `CODE-${id}`],
  );
}

async function setSquadMembers(id: string, memberIds: string[]): Promise<void> {
  await dbmod.pool.query(`UPDATE squads SET member_ids = $2::jsonb WHERE id = $1`, [
    id,
    JSON.stringify(memberIds),
  ]);
}

async function seedEvent(opts: {
  id: string;
  hostId: string;
  squadId?: string;
  type?: string;
  rsvps?: Record<string, string>;
  invitedUserIds?: string[];
  messages?: unknown[];
  cancelled?: boolean;
}): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO events
       (id, type, title, date, location, host_id, squad_id, invite_code,
        rsvps, invited_user_ids, messages, cancelled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)`,
    [
      opts.id,
      opts.type ?? "event",
      `Plan ${opts.id}`,
      "2026-12-31",
      "Somewhere",
      opts.hostId,
      opts.squadId ?? "",
      `EVT-${opts.id}`,
      JSON.stringify(opts.rsvps ?? {}),
      JSON.stringify(opts.invitedUserIds ?? []),
      JSON.stringify(opts.messages ?? []),
      opts.cancelled ?? false,
    ],
  );
}

async function threadCountFor(eventId: string): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT count(*)::int AS c FROM conversations WHERE event_id = $1`,
    [eventId],
  );
  return rows[0]?.c ?? 0;
}

async function embeddedMessageCount(eventId: string): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `SELECT jsonb_array_length(COALESCE(messages, '[]'::jsonb))::int AS c FROM events WHERE id = $1`,
    [eventId],
  );
  return rows[0]?.c ?? 0;
}

async function eventVersion(eventId: string): Promise<number> {
  const { rows } = await dbmod.pool.query(`SELECT version FROM events WHERE id = $1`, [eventId]);
  return rows[0]?.version ?? 0;
}

// ── 1. Exactly one thread per plan ────────────────────────────────────────────

describe("exactly one chat thread per plan", () => {
  const host = "pc-host";
  const m1 = "pc-m1";
  const m2 = "pc-m2";
  const squad = "pc-squad";
  const plan = "pc-plan-1";

  beforeAll(async () => {
    for (const u of [host, m1, m2]) await seedUser(u);
    await seedSquad(squad, [host, m1, m2]);
    await seedEvent({ id: plan, hostId: host, squadId: squad });
  });

  it("converges on ONE thread when three members open the chat concurrently", async () => {
    const results = await Promise.all([
      storage.getOrCreateEventConversation(plan, host),
      storage.getOrCreateEventConversation(plan, m1),
      storage.getOrCreateEventConversation(plan, m2),
    ]);
    const ids = new Set(results.map((c) => c?.id));
    expect(results.every((c) => c != null)).toBe(true);
    expect(ids.size).toBe(1);
    expect(await threadCountFor(plan)).toBe(1);
  });

  it("re-opening later returns the SAME thread (no second row)", async () => {
    const again = await storage.getOrCreateEventConversation(plan, m1);
    expect(again).not.toBeNull();
    expect(await threadCountFor(plan)).toBe(1);
  });

  it("seeds every current squad member as a participant", async () => {
    const convo = await storage.getOrCreateEventConversation(plan, host);
    const participants = await storage.getConversationParticipants(convo!.id);
    expect(participants.map((p) => p.userId).sort()).toEqual([host, m1, m2].sort());
  });
});

// ── 2. Access is re-derived from CURRENT visibility ───────────────────────────

describe("plan chat access follows CURRENT plan visibility", () => {
  const host = "pa-host";
  const member = "pa-member";
  const stranger = "pa-stranger";
  const invitee = "pa-invitee";
  const squad = "pa-squad";
  const plan = "pa-plan";
  const trip = "pa-trip";

  beforeAll(async () => {
    for (const u of [host, member, stranger, invitee]) await seedUser(u);
    await seedSquad(squad, [host, member]);
    await seedEvent({ id: plan, hostId: host, squadId: squad, invitedUserIds: [invitee] });
    // A trip with a STALE rsvp key for someone who is not (or no longer) in the
    // squad — trips must ignore rsvps entirely.
    await seedEvent({
      id: trip,
      hostId: host,
      squadId: squad,
      type: "trip",
      rsvps: { [stranger]: "going" },
    });
  });

  it("a stranger cannot open the thread", async () => {
    expect(await storage.getOrCreateEventConversation(plan, stranger)).toBeNull();
  });

  it("an explicitly invited non-member can open the thread", async () => {
    expect(await storage.getOrCreateEventConversation(plan, invitee)).not.toBeNull();
  });

  it("a stale RSVP does NOT grant trip chat access", async () => {
    expect(await storage.getOrCreateEventConversation(trip, stranger)).toBeNull();
  });

  it("removing someone from the squad revokes thread access even though the participant row survives", async () => {
    const convo = await storage.getOrCreateEventConversation(plan, member);
    expect(convo).not.toBeNull();
    // Their participant row exists...
    const before = await storage.getConversationParticipants(convo!.id);
    expect(before.map((p) => p.userId)).toContain(member);

    await setSquadMembers(squad, [host]);

    // ...but access is re-checked live, so the thread is gone for them.
    expect(await storage.getConversationForMember(convo!.id, member)).toBeNull();
    // The row itself is deliberately NOT pruned (append-only contract).
    const after = await storage.getConversationParticipants(convo!.id);
    expect(after.map((p) => p.userId)).toContain(member);
    // ...and it must not resurface in their inbox or unread badge.
    const inbox = await storage.listConversationsForUser(member);
    expect(inbox.some((c) => c.id === convo!.id)).toBe(false);

    await setSquadMembers(squad, [host, member]);
  });
});

// ── 3. Chat sends never touch the parent event version ────────────────────────

describe("plan chat is decoupled from the event record", () => {
  const host = "pv-host";
  const plan = "pv-plan";

  beforeAll(async () => {
    await seedUser(host);
    await seedEvent({ id: plan, hostId: host });
  });

  it("sending a message leaves events.version untouched", async () => {
    const convo = await storage.getOrCreateEventConversation(plan, host);
    const before = await eventVersion(plan);
    await storage.addConversationMessage(convo!.id, host, "no version bump please", []);
    await storage.addConversationMessage(convo!.id, host, "still none", []);
    expect(await eventVersion(plan)).toBe(before);
  });

  it("messages paginate oldest-first with a cursor", async () => {
    const convo = await storage.getOrCreateEventConversation(plan, host);
    for (let i = 0; i < 8; i++) {
      await storage.addConversationMessage(convo!.id, host, `m${i}`, []);
    }
    const page1 = await storage.getConversationMessages(convo!.id, { limit: 5 });
    expect(page1.messages).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    const older = await storage.getConversationMessages(convo!.id, {
      limit: 5,
      before: page1.messages[0].id,
    });
    expect(older.messages.length).toBeGreaterThan(0);
    // No overlap between pages.
    const ids = new Set(page1.messages.map((m) => m.id));
    expect(older.messages.every((m) => !ids.has(m.id))).toBe(true);
  });
});

// ── 4. Legacy backfill ────────────────────────────────────────────────────────

describe("embedded events.messages backfill", () => {
  const host = "bf-host";
  const member = "bf-member";
  const squad = "bf-squad";
  const plan = "bf-plan";

  const legacy = [
    { id: "m1", senderId: "bf-host", text: "first", time: "2d", createdAt: "2026-01-01T10:00:00.000Z" },
    { id: "m2", senderId: "bf-member", text: "second", time: "1d", createdAt: "2026-01-02T10:00:00.000Z" },
    // A pre-timestamp message: only the display string was ever recorded.
    { id: "m3", senderId: "bf-host", text: "third", time: "Just now" },
  ];

  let versionBeforeMigration = 0;

  beforeAll(async () => {
    for (const u of [host, member]) await seedUser(u);
    await seedSquad(squad, [host, member]);
    await seedEvent({ id: plan, hostId: host, squadId: squad, messages: legacy });
    versionBeforeMigration = await eventVersion(plan);
  });

  it("moves every embedded message into the thread, preserving sender and order", async () => {
    await migrateEmbeddedEventMessages();
    const convo = await storage.getOrCreateEventConversation(plan, host);
    expect(convo).not.toBeNull();
    const { messages } = await storage.getConversationMessages(convo!.id, { limit: 50 });
    expect(messages.map((m) => m.text)).toEqual(["first", "second", "third"]);
    expect(messages.map((m) => m.senderId)).toEqual([host, member, host]);
  });

  it("drains the legacy JSON column so the plan record no longer carries chat", async () => {
    expect(await embeddedMessageCount(plan)).toBe(0);
  });

  it("does not bump the plan's version while migrating", async () => {
    // Draining the JSON column must not invalidate any in-flight client's
    // optimistic write — chat is no longer part of the event record.
    expect(await eventVersion(plan)).toBe(versionBeforeMigration);
  });

  it("is idempotent — a second run inserts nothing and creates no second thread", async () => {
    await migrateEmbeddedEventMessages();
    const convo = await storage.getOrCreateEventConversation(plan, host);
    const { messages } = await storage.getConversationMessages(convo!.id, { limit: 50 });
    expect(messages).toHaveLength(3);
    expect(await threadCountFor(plan)).toBe(1);
  });

  it("re-running after the JSON is re-seeded still cannot duplicate a migrated message", async () => {
    // Simulates a partially-applied run: the same legacy ids come back around.
    await dbmod.pool.query(`UPDATE events SET messages = $2::jsonb WHERE id = $1`, [
      plan,
      JSON.stringify(legacy),
    ]);
    await migrateEmbeddedEventMessages();
    const convo = await storage.getOrCreateEventConversation(plan, host);
    const { messages } = await storage.getConversationMessages(convo!.id, { limit: 50 });
    expect(messages).toHaveLength(3);
  });

  it("stamps the migrated audience as caught up (no wall of unread history)", async () => {
    expect(await storage.getTotalUnreadCount(member)).toBe(0);
  });

  it("surfaces the migrated thread in the inbox with the plan's title", async () => {
    const inbox = await storage.listConversationsForUser(member);
    const row = inbox.find((c) => c.eventId === plan);
    expect(row).toBeDefined();
    expect(row!.type).toBe("event");
    expect(row!.title).toBe(`Plan ${plan}`);
    expect(row!.lastMessagePreview).toBe("third");
  });
});
