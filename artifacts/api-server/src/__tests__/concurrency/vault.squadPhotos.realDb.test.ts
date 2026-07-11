import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

/**
 * Real-database regression guard for the squad photo vault (task #495).
 *
 * The squad has TWO photo-reading surfaces that must never disagree on the set
 * of photos "belonging to a squad":
 *   - GET /api/squads/:id/vault  → storage.getSquadVaultPhotos (the curated
 *     roll-up the vault SCREEN renders)
 *   - GET /api/vault/photos?squadId= → storage.getPhotosBySquadId
 *
 * getPhotosBySquadId historically filtered ONLY on photos whose eventId belongs
 * to an event in the squad, silently dropping event-less photos shared straight
 * to the squad vault. This test seeds one such "shared straight to squad" photo
 * (squadId set, sharedToSquad = true, eventId NULL) alongside an event roll-up
 * photo and asserts BOTH surfaces return the event-less photo — so the two
 * endpoints stay reconciled and no one "fixes" the screen onto a lossy read.
 *
 * Like the concurrency suite, this boots a throwaway local Postgres and refuses
 * to run against any remote/Supabase database. It lives in the concurrency
 * directory so it shares that suite's real-DB isolation (excluded from the
 * default unit run; runs via `pnpm --filter @workspace/api-server run
 * test:concurrency`).
 */

let baseDir = "";
let dataDir = "";
let pgStarted = false;
let dbmod: typeof import("@workspace/db");
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

beforeAll(async () => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "squadz-vault-pg-"));
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

  // Import the storage singleton AFTER the env is locked to the local cluster.
  storage = (await import("../../storage")).storage;
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
     VALUES ($1, $2, $3::jsonb, false, $4)`,
    [id, `Squad ${id}`, JSON.stringify(memberIds), `CODE-${id}`],
  );
}

async function seedEvent(id: string, squadId: string, hostId: string): Promise<void> {
  await dbmod.pool.query(
    `INSERT INTO events (id, title, date, location, host_id, squad_id, invite_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, "Test Event", "2026-12-31", "Somewhere", hostId, squadId, `EVT-${id}`],
  );
}

/** Insert a photo row directly so we control eventId / squadId / sharedToSquad. */
async function seedPhoto(opts: {
  uploaderId: string;
  url: string;
  eventId?: string | null;
  squadId?: string | null;
  sharedToSquad?: boolean;
}): Promise<number> {
  const { rows } = await dbmod.pool.query(
    `INSERT INTO photos (uploader_id, url, event_id, squad_id, shared_to_squad)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [opts.uploaderId, opts.url, opts.eventId ?? null, opts.squadId ?? null, opts.sharedToSquad ?? false],
  );
  return rows[0].id as number;
}

describe("squad vault surfaces stay reconciled (event-less shared photos)", () => {
  const member = "vault-member";
  const squad = "vault-squad";
  const event = "vault-event";

  let eventPhotoId = 0;
  let sharedPhotoId = 0;

  beforeAll(async () => {
    await seedUser(member);
    await seedSquad(squad, [member]);
    await seedEvent(event, squad, member);
    // (1) a normal event roll-up photo.
    eventPhotoId = await seedPhoto({
      uploaderId: member,
      url: "/objects/uploads/event-photo.jpg",
      eventId: event,
    });
    // (2) a photo shared STRAIGHT to the squad vault, no event.
    sharedPhotoId = await seedPhoto({
      uploaderId: member,
      url: "/objects/uploads/shared-straight.jpg",
      squadId: squad,
      sharedToSquad: true,
      eventId: null,
    });
  });

  it("getSquadVaultPhotos (the vault screen surface) includes the event-less shared photo", async () => {
    const photos = await storage.getSquadVaultPhotos(squad);
    const ids = photos.map((p) => p.id);
    expect(ids).toContain(sharedPhotoId);
  });

  it("getPhotosBySquadId returns BOTH the event roll-up AND the event-less shared photo", async () => {
    const { authorized, photos } = await storage.getPhotosBySquadId(squad, member);
    expect(authorized).toBe(true);
    const ids = photos.map((p) => p.id);
    // The regression this task guards: the event-less shared photo must NOT be
    // silently dropped just because it has no eventId.
    expect(ids).toContain(sharedPhotoId);
    expect(ids).toContain(eventPhotoId);
  });

  it("getPhotosBySquadId still returns event-less shared photos when the squad has NO events", async () => {
    const soloSquad = "vault-squad-no-events";
    await seedSquad(soloSquad, [member]);
    const onlyShared = await seedPhoto({
      uploaderId: member,
      url: "/objects/uploads/solo-shared.jpg",
      squadId: soloSquad,
      sharedToSquad: true,
      eventId: null,
    });

    const { authorized, photos } = await storage.getPhotosBySquadId(soloSquad, member);
    expect(authorized).toBe(true);
    expect(photos.map((p) => p.id)).toContain(onlyShared);
  });

  it("non-members are still denied", async () => {
    const stranger = "vault-stranger";
    await seedUser(stranger);
    const { authorized, photos } = await storage.getPhotosBySquadId(squad, stranger);
    expect(authorized).toBe(false);
    expect(photos).toHaveLength(0);
  });
});
