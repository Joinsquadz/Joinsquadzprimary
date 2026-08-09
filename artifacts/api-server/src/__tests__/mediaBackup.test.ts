/**
 * Unit tests for the nightly Supabase Storage -> Cloudflare R2 media backup.
 *
 * Covers:
 *   1. POST /api/internal/media-backup auth guard (missing / wrong / unset token).
 *   2. Multi-instance safety: a run skips when another instance holds the lock.
 *   3. Incremental copy: objects already present in R2 with the same size are
 *      skipped; new or size-changed objects are copied.
 *   4. Backup covers BOTH Supabase buckets and preserves the bucket prefix.
 *   5. Per-object failures are counted, do not abort the run, and raise a
 *      Sentry warning.
 *   6. The run is skipped (not crashed) when R2 config is absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// Bucket names are read at module load from env. Pin them here (hoisted, so it
// runs before the module under test is imported) — the deployed value of
// SUPABASE_STORAGE_BUCKET is a display-style name and must not leak into tests.
vi.hoisted(() => {
  process.env.SUPABASE_STORAGE_BUCKET = "squadz-media";
  process.env.SUPABASE_PUBLIC_BUCKET = "squadz-avatars";
});

// ── Mocks — hoisted before any import ────────────────────────────────────────
const mockSend = vi.hoisted(() => vi.fn());
const mockConnect = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockRelease = vi.hoisted(() => vi.fn());
const mockCaptureMessage = vi.hoisted(() => vi.fn());
const mockList = vi.hoisted(() => vi.fn());
const mockDownload = vi.hoisted(() => vi.fn());

// Command classes must be created inside vi.hoisted: the vi.mock factory below
// is hoisted above normal top-level declarations, so plain classes would still
// be in the temporal dead zone when the factory runs.
const { HeadObjectCommand, PutObjectCommand, ListObjectsV2Command } = vi.hoisted(() => ({
  HeadObjectCommand: class {
    constructor(public readonly input: { Bucket: string; Key: string }) {}
  },
  PutObjectCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
  ListObjectsV2Command: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  HeadObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mockConnect, query: mockPoolQuery },
}));

vi.mock("../services/supabase", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string, opts: unknown) => mockList(bucket, prefix, opts),
        download: (key: string) => mockDownload(bucket, key),
      }),
    },
  },
}));

vi.mock("../services/monitoring", () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
}));

vi.mock("../lib/objectStorage", () => ({
  objectStorageClient: {
    bucket: () => ({ getFiles: vi.fn(async () => [[], null, {}]) }),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks.
import mediaBackupRouter from "../routes/mediaBackup";
import {
  checkMediaBackupFreshness,
  getMediaBackupStatus,
  MEDIA_BACKUP_STALE_AFTER_MS,
  runMediaBackup,
} from "../lib/mediaBackup";

const TEST_TOKEN = "internal-token-xyz789";
const PRIVATE_BUCKET = "squadz-media";
const PUBLIC_BUCKET = "squadz-avatars";

/** A Supabase list() row for a real file (has `id`). */
function file(name: string, size: number) {
  return { id: `id-${name}`, name, metadata: { size, mimetype: "image/jpeg" } };
}

/**
 * Makes list() return `rows` for the first page of `bucket`, then empty, and
 * makes download() return a body whose byte length matches the listed size —
 * copiedBytes is measured from the real payload, not the listing metadata.
 */
function seedBuckets(rows: Record<string, ReturnType<typeof file>[]>) {
  const sizes = new Map<string, number>();
  for (const [bucket, entries] of Object.entries(rows)) {
    for (const entry of entries) sizes.set(`${bucket}/${entry.name}`, entry.metadata.size);
  }
  mockList.mockImplementation(async (bucket: string, prefix: string) => {
    if (prefix !== "") return { data: [], error: null };
    return { data: rows[bucket] ?? [], error: null };
  });
  mockDownload.mockImplementation(async (bucket: string, key: string) => ({
    data: { arrayBuffer: async () => new Uint8Array(sizes.get(`${bucket}/${key}`) ?? 0).buffer },
    error: null,
  }));
}

function grantLock(locked: boolean) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked }] };
    return { rows: [] };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.R2_ACCESS_KEY_ID = "test-key-id";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_ENDPOINT = "https://account.r2.cloudflarestorage.com";
  process.env.R2_BACKUP_BUCKET = "squadz-media-backup";
  delete process.env.PRIVATE_OBJECT_DIR;
  delete process.env.PUBLIC_OBJECT_SEARCH_PATHS;

  mockConnect.mockResolvedValue({ query: mockQuery, release: mockRelease });
  mockPoolQuery.mockResolvedValue({ rows: [] });
  grantLock(true);
  seedBuckets({});
  mockDownload.mockResolvedValue({
    data: { arrayBuffer: async () => new TextEncoder().encode("body").buffer },
    error: null,
  });
});

afterEach(() => {
  delete process.env.INTERNAL_API_TOKEN;
  delete process.env.R2_ACCESS_KEY_ID;
  delete process.env.R2_SECRET_ACCESS_KEY;
  delete process.env.R2_ENDPOINT;
  delete process.env.R2_BACKUP_BUCKET;
});

// ── Manual trigger auth guard ────────────────────────────────────────────────

describe("POST /api/internal/media-backup — auth guard", () => {
  function makeApp(token?: string) {
    if (token !== undefined) process.env.INTERNAL_API_TOKEN = token;
    else delete process.env.INTERNAL_API_TOKEN;
    const app = express();
    app.use("/api", mediaBackupRouter);
    return app;
  }

  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(makeApp(TEST_TOKEN)).post("/api/internal/media-backup");
    expect(res.status).toBe(401);
  });

  it("returns 401 when the token is wrong", async () => {
    const res = await request(makeApp(TEST_TOKEN))
      .post("/api/internal/media-backup")
      .set("Authorization", "Bearer nope");
    expect(res.status).toBe(401);
  });

  it("returns 401 when INTERNAL_API_TOKEN is not configured", async () => {
    const res = await request(makeApp(undefined))
      .post("/api/internal/media-backup")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it("runs the backup and returns a summary with the correct token", async () => {
    const res = await request(makeApp(TEST_TOKEN))
      .post("/api/internal/media-backup")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checked: 0, copied: 0, failures: 0, skipped: false });
    expect(res.body.sources).toEqual(
      expect.arrayContaining([`supabase:${PRIVATE_BUCKET}`, `supabase:${PUBLIC_BUCKET}`]),
    );
  });
});

// ── Multi-instance safety ────────────────────────────────────────────────────

describe("runMediaBackup — multi-instance safety", () => {
  it("skips the run when another instance holds the advisory lock", async () => {
    grantLock(false);
    seedBuckets({ [PRIVATE_BUCKET]: [file("a.jpg", 10)] });

    const summary = await runMediaBackup();

    expect(summary.skipped).toBe(true);
    expect(summary.checked).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalled();
  });

  it("releases the pooled connection even when the run throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("BEGIN failed"));
    await expect(runMediaBackup()).rejects.toThrow();
    expect(mockRelease).toHaveBeenCalled();
  });
});

// ── Incremental copy ─────────────────────────────────────────────────────────

describe("runMediaBackup — incremental copy", () => {
  it("skips objects already in R2 with a matching size", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("already.jpg", 128)] });
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) return { ContentLength: 128 };
      throw new Error("should not copy an unchanged object");
    });

    const summary = await runMediaBackup();

    expect(summary.checked).toBe(1);
    expect(summary.copied).toBe(0);
    expect(summary.failures).toBe(0);
  });

  it("copies objects missing from R2 under the source-bucket prefix", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("new.jpg", 256)] });
    const puts: InstanceType<typeof PutObjectCommand>[] = [];
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
      }
      puts.push(cmd as InstanceType<typeof PutObjectCommand>);
      return {};
    });

    const summary = await runMediaBackup();

    expect(summary.copied).toBe(1);
    expect(summary.copiedBytes).toBe(256);
    expect(puts[0]?.input).toMatchObject({
      Bucket: "squadz-media-backup",
      Key: `supabase/${PRIVATE_BUCKET}/new.jpg`,
    });
  });

  it("re-copies an object whose size changed at the source", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("changed.jpg", 500)] });
    mockSend.mockImplementation(async (cmd: unknown) =>
      cmd instanceof HeadObjectCommand ? { ContentLength: 120 } : {},
    );

    const summary = await runMediaBackup();

    expect(summary.copied).toBe(1);
  });

  it("backs up every configured Supabase bucket, not just the private one", async () => {
    seedBuckets({
      [PRIVATE_BUCKET]: [file("moment.jpg", 10)],
      [PUBLIC_BUCKET]: [file("avatar.png", 20)],
    });
    const keys: string[] = [];
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
      }
      keys.push((cmd as InstanceType<typeof PutObjectCommand>).input.Key as string);
      return {};
    });

    const summary = await runMediaBackup();

    expect(summary.checked).toBe(2);
    expect(summary.copied).toBe(2);
    expect(keys).toEqual(
      expect.arrayContaining([
        `supabase/${PRIVATE_BUCKET}/moment.jpg`,
        `supabase/${PUBLIC_BUCKET}/avatar.png`,
      ]),
    );
  });
});

// ── Failure reporting ────────────────────────────────────────────────────────

describe("runMediaBackup — failure reporting", () => {
  it("counts a failed object, continues the run, and warns Sentry", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("bad.jpg", 10), file("good.jpg", 20)] });
    mockSend.mockImplementation(async (cmd: unknown) => {
      if (cmd instanceof HeadObjectCommand) {
        if (cmd.input.Key.endsWith("bad.jpg")) throw new Error("R2 head exploded");
        throw Object.assign(new Error("not found"), { $metadata: { httpStatusCode: 404 } });
      }
      return {};
    });

    const summary = await runMediaBackup();

    expect(summary.checked).toBe(2);
    expect(summary.copied).toBe(1);
    expect(summary.failures).toBe(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(expect.stringContaining("failure"), "warning");
  });

  it("does not warn Sentry on a clean run", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("ok.jpg", 5)] });
    mockSend.mockImplementation(async (cmd: unknown) =>
      cmd instanceof HeadObjectCommand ? { ContentLength: 5 } : {},
    );

    await runMediaBackup();

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("persists a durable success marker only after a zero-failure run", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("ok.jpg", 5)] });
    mockSend.mockImplementation(async (cmd: unknown) =>
      cmd instanceof HeadObjectCommand ? { ContentLength: 5 } : {},
    );

    await runMediaBackup();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO media_backup_status"),
      expect.arrayContaining([1, expect.any(String), expect.any(String)]),
    );
  });

  it("commits the success marker so it survives the lock transaction", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("ok.jpg", 5)] });
    mockSend.mockImplementation(async (cmd: unknown) =>
      cmd instanceof HeadObjectCommand ? { ContentLength: 5 } : {},
    );

    await runMediaBackup();

    const statements = mockQuery.mock.calls.map(([sql]) => sql as string);
    const insertIndex = statements.findIndex((sql) => sql.includes("INSERT INTO media_backup_status"));
    const commitIndex = statements.findIndex((sql) => sql === "COMMIT");
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    // The marker is written inside the advisory-lock transaction: without a
    // COMMIT after it, the finally-block ROLLBACK silently discards it.
    expect(commitIndex).toBeGreaterThan(insertIndex);
    expect(statements).not.toContain("ROLLBACK");
  });

  it("rolls back (never commits) when the run fails partway", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("bad.jpg", 10)] });
    mockSend.mockRejectedValue(new Error("R2 unavailable"));

    await runMediaBackup();

    const statements = mockQuery.mock.calls.map(([sql]) => sql as string);
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("does not advance the success marker after a partial backup", async () => {
    seedBuckets({ [PRIVATE_BUCKET]: [file("bad.jpg", 10)] });
    mockSend.mockRejectedValue(new Error("R2 unavailable"));

    await runMediaBackup();

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO media_backup_status"),
      expect.anything(),
    );
  });
});

// ── Durable dead-man switch ───────────────────────────────────────────────────

describe("media backup dead-man switch", () => {
  it("reports a missing success marker as stale", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });
    const status = await getMediaBackupStatus(Date.UTC(2026, 7, 9));
    expect(status).toMatchObject({ lastSuccessAt: null, ageMs: null, stale: true, thresholdHours: 36 });
  });

  it("reports a recent successful run as fresh", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    mockPoolQuery.mockResolvedValue({ rows: [{ last_success_at: new Date(now - 2 * 60 * 60 * 1000) }] });
    const status = await getMediaBackupStatus(now);
    expect(status).toMatchObject({ stale: false, thresholdHours: 36 });
    expect(status.ageMs).toBe(2 * 60 * 60 * 1000);
  });

  it("reports a run beyond the 36-hour threshold as stale and alerts once", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    mockPoolQuery.mockResolvedValue({
      rows: [{ last_success_at: new Date(now - MEDIA_BACKUP_STALE_AFTER_MS - 1) }],
    });
    const first = await checkMediaBackupFreshness(now);
    const second = await checkMediaBackupFreshness(now);

    expect(first.stale).toBe(true);
    expect(second.stale).toBe(true);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  });
});

// ── Configuration guard ──────────────────────────────────────────────────────

describe("runMediaBackup — configuration guard", () => {
  it("skips (does not throw or touch the DB) when R2 credentials are absent", async () => {
    delete process.env.R2_BACKUP_BUCKET;
    seedBuckets({ [PRIVATE_BUCKET]: [file("a.jpg", 10)] });

    const summary = await runMediaBackup();

    expect(summary.skipped).toBe(true);
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
