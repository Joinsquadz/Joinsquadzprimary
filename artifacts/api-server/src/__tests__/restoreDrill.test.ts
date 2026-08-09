/**
 * Unit tests for the operator-only R2 -> temporary Supabase restore drill.
 *
 * Covers:
 *   1. Destination guards: live buckets and non-scratch names are refused.
 *   2. A clean drill verifies bytes + sha256 + content type and cleans up.
 *   3. A content-type regression FAILS the drill (bytes alone are not proof).
 *   4. Corrupted / truncated bytes fail the drill.
 *   5. Cleanup still runs when verification fails, and the exit code is 1.
 *   6. Key mapping strips the backup's routing prefix.
 *   7. An existing destination bucket is refused unless explicitly reused.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  assertScratchDestination,
  destinationKey,
  exitCodeFor,
  isBucketNotFound,
  normalizeContentType,
  RestoreDrillCleanupError,
  supabaseDrillBucket,
  runRestoreDrill,
  verifyRestoredObject,
  type BackupSource,
  type DrillArgs,
  type DrillDestination,
} from "../scripts/restore-drill";

const DRILL_BUCKET = "restore-drill-test";

function args(overrides: Partial<DrillArgs> = {}): DrillArgs {
  return {
    prefix: "supabase/squadz-avatars/",
    bucket: DRILL_BUCKET,
    limit: 3,
    keep: false,
    reuseBucket: false,
    ...overrides,
  };
}

/** In-memory backup with one JPEG object. */
function source(objects: Record<string, { body: Buffer; contentType?: string }>): BackupSource {
  return {
    list: async (prefix, limit) =>
      Object.keys(objects).filter((key) => key.startsWith(prefix)).slice(0, limit),
    get: async (key) => objects[key]!,
  };
}

/**
 * In-memory drill bucket. `mutate` lets a test simulate a destination that
 * returns something different from what was uploaded.
 */
function destination(options: {
  existsInitially?: boolean;
  mutate?: (stored: { body: Buffer; contentType: string }) => { body: Buffer; contentType: string };
  /** Simulate Supabase refusing to remove the drill objects. */
  failRemove?: boolean;
  /** Simulate Supabase refusing to delete the drill bucket. */
  failDestroy?: boolean;
  /** Simulate the post-cleanup existence check itself erroring out. */
  failExistsAfterDestroy?: boolean;
  /** Simulate delete "succeeding" while the bucket is really still there. */
  bucketSurvivesDestroy?: boolean;
} = {}) {
  const store = new Map<string, { body: Buffer; contentType: string }>();
  let exists = options.existsInitially ?? false;
  let destroyed = false;
  const calls = { created: 0, removed: [] as string[], destroyed: 0 };

  const dest: DrillDestination = {
    exists: async () => {
      if (destroyed && options.failExistsAfterDestroy) {
        throw new Error('Could not determine whether "restore-drill-test" exists: network down');
      }
      return exists;
    },
    create: async () => {
      exists = true;
      calls.created += 1;
    },
    upload: async (key, body, contentType) => {
      store.set(key, { body, contentType });
    },
    download: async (key) => {
      const stored = store.get(key);
      if (!stored) throw new Error(`missing ${key}`);
      return options.mutate ? options.mutate(stored) : stored;
    },
    remove: async (keys) => {
      if (options.failRemove) throw new Error("Could not remove drill objects: permission denied");
      for (const key of keys) store.delete(key);
      calls.removed.push(...keys);
    },
    destroy: async () => {
      if (options.failDestroy) throw new Error("Could not delete drill bucket: bucket not empty");
      calls.destroyed += 1;
      destroyed = true;
      if (options.bucketSurvivesDestroy) return;
      store.clear();
      exists = false;
    },
  };
  return { dest, store, calls };
}

const JPEG_KEY = "supabase/squadz-avatars/uploads/photo.jpeg";
const jpegBody = Buffer.from("pretend-jpeg-bytes");

beforeEach(() => {
  process.env.SUPABASE_STORAGE_BUCKET = "Squadz storage bucket";
  process.env.SUPABASE_PUBLIC_BUCKET = "squadz-avatars";
});

afterEach(() => {
  delete process.env.SUPABASE_STORAGE_BUCKET;
  delete process.env.SUPABASE_PUBLIC_BUCKET;
});

// ── Destination guards ───────────────────────────────────────────────────────

describe("restore drill — destination guards", () => {
  it("refuses the configured live private bucket", () => {
    expect(() => assertScratchDestination("Squadz storage bucket")).toThrow(/LIVE media bucket/);
  });

  it("refuses the configured live public bucket regardless of casing", () => {
    expect(() => assertScratchDestination("SQUADZ-AVATARS")).toThrow(/LIVE media bucket/);
  });

  it("refuses any bucket that is not named as a drill bucket", () => {
    expect(() => assertScratchDestination("some-other-bucket")).toThrow(/must start with/);
  });

  it("accepts a scratch bucket", () => {
    expect(() => assertScratchDestination("restore-drill-20260809")).not.toThrow();
  });

  it("refuses an existing bucket unless --reuse-bucket is passed", async () => {
    const { dest } = destination({ existsInitially: true });
    await expect(runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    })).rejects.toThrow(/already exists/);
  });
});

// ── Key mapping / normalisation ──────────────────────────────────────────────

describe("restore drill — key mapping and content types", () => {
  it("strips the backup routing prefix so objects land on their original path", () => {
    expect(destinationKey("supabase/squadz-avatars/uploads/a.jpeg")).toBe("uploads/a.jpeg");
    expect(destinationKey("replit/bucket-name/.private/uploads/b.mp4")).toBe(".private/uploads/b.mp4");
    expect(destinationKey("loose-key.jpg")).toBe("loose-key.jpg");
  });

  it("ignores casing and parameters but not the media type itself", () => {
    expect(normalizeContentType("IMAGE/JPEG")).toBe("image/jpeg");
    expect(normalizeContentType("image/jpeg; charset=utf-8")).toBe("image/jpeg");
    expect(normalizeContentType(undefined)).toBe("application/octet-stream");
    expect(normalizeContentType("video/mp4")).not.toBe("image/jpeg");
  });

  it("treats a differing media type as a verification failure", () => {
    const result = verifyRestoredObject({
      key: "a.jpeg",
      sourceBody: jpegBody,
      restoredBody: jpegBody,
      sourceContentType: "image/jpeg",
      restoredContentType: "application/octet-stream",
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join()).toContain("content-type");
  });
});

// ── Bucket absence detection ─────────────────────────────────────────────────

describe("restore drill — bucket absence is proven only by a 404", () => {
  it("treats an explicit 404 in any status field as absence", () => {
    expect(isBucketNotFound({ status: 404, message: "Bucket not found" })).toBe(true);
    expect(isBucketNotFound({ statusCode: "404", message: "Bucket not found" })).toBe(true);
    expect(isBucketNotFound({ statusCode: 404 })).toBe(true);
  });

  it("matches the real Supabase missing-bucket shape (status 400, statusCode '404')", () => {
    // StorageApiError for a genuinely absent bucket reports a numeric status of
    // 400 alongside a string statusCode of "404"; absence must still be
    // recognised, or every drill fails to start.
    expect(isBucketNotFound({
      name: "StorageApiError",
      message: "Bucket not found",
      status: 400,
      statusCode: "404",
    } as { message: string; status: number; statusCode: string })).toBe(true);
  });

  it("does NOT trust a 'not found' message without a 404 status", () => {
    // An auth/network failure whose text merely mentions "not found" must never
    // be read as confirmed cleanup.
    expect(isBucketNotFound({ message: "Bucket not found" })).toBe(false);
    expect(isBucketNotFound({ message: "project not found or unauthorized", status: 401 })).toBe(false);
    expect(isBucketNotFound({ message: "service not found", status: 500 })).toBe(false);
    expect(isBucketNotFound({ message: "not found", statusCode: "503" })).toBe(false);
    expect(isBucketNotFound({ message: "not found", statusCode: "unknown" })).toBe(false);
    expect(isBucketNotFound({ message: "gateway timeout", status: 504, statusCode: "504" })).toBe(false);
    expect(isBucketNotFound({ message: "not found in cache", status: 500 })).toBe(false);
  });

  it("does not report absence for ordinary failures", () => {
    expect(isBucketNotFound({ message: "network unreachable" })).toBe(false);
    expect(isBucketNotFound({})).toBe(false);
  });
});

describe("restore drill — Supabase existence check fails closed", () => {
  const fakeAdmin = (response: { data?: unknown; error?: unknown }) =>
    ({ storage: { getBucket: async () => response } }) as unknown as Parameters<typeof supabaseDrillBucket>[0];

  it("reports presence when the bucket is returned", async () => {
    const dest = supabaseDrillBucket(fakeAdmin({ data: { name: DRILL_BUCKET }, error: null }), DRILL_BUCKET);
    await expect(dest.exists()).resolves.toBe(true);
  });

  it("reports absence only on an explicit 404", async () => {
    const dest = supabaseDrillBucket(
      fakeAdmin({ data: null, error: { message: "Bucket not found", status: 400, statusCode: "404" } }),
      DRILL_BUCKET,
    );
    await expect(dest.exists()).resolves.toBe(false);
  });

  it("throws when Supabase returns neither data nor an error", async () => {
    // An ambiguous response is NOT proof of absence — treating it as absence
    // would confirm a cleanup that never happened, or create over live data.
    const dest = supabaseDrillBucket(fakeAdmin({ data: null, error: null }), DRILL_BUCKET);
    await expect(dest.exists()).rejects.toThrow(/neither bucket data nor an error/);
  });

  it("throws on a non-404 error even when its message says 'not found'", async () => {
    const dest = supabaseDrillBucket(
      fakeAdmin({ data: null, error: { message: "project not found or unauthorized", status: 401, statusCode: "401" } }),
      DRILL_BUCKET,
    );
    await expect(dest.exists()).rejects.toThrow(/Could not determine whether/);
  });
});

// ── Drill outcomes ───────────────────────────────────────────────────────────

describe("restore drill — verification outcomes", () => {
  it("verifies bytes, hash and content type on a clean drill, then cleans up", async () => {
    const { dest, calls } = destination();

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.restoredCount).toBe(1);
    expect(summary.verified).toBe(1);
    expect(summary.mismatches).toBe(0);
    expect(summary.sourceBytes).toBe(jpegBody.byteLength);
    expect(summary.restoredBytes).toBe(jpegBody.byteLength);
    expect(summary.objects[0]!.sourceHash).toBe(summary.objects[0]!.restoredHash);
    expect(summary.objects[0]!.restoredContentType).toBe("image/jpeg");
    expect(summary.cleanedUp).toBe(true);
    expect(calls.removed).toEqual(["uploads/photo.jpeg"]);
    expect(calls.destroyed).toBe(1);
    expect(exitCodeFor(summary)).toBe(0);
  });

  it("fails the drill when the destination serves the right bytes under the wrong type", async () => {
    const { dest } = destination({
      mutate: (stored) => ({ body: stored.body, contentType: "application/octet-stream" }),
    });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.mismatches).toBe(1);
    expect(summary.verified).toBe(0);
    expect(summary.objects[0]!.failures.join()).toContain("content-type image/jpeg -> application/octet-stream");
    // A failed verification must still exit non-zero AND still clean up.
    expect(exitCodeFor(summary)).toBe(1);
    expect(summary.cleanedUp).toBe(true);
  });

  it("fails the drill when the restored bytes are corrupted", async () => {
    const { dest } = destination({
      mutate: (stored) => ({ body: Buffer.from("corrupted"), contentType: stored.contentType }),
    });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.mismatches).toBe(1);
    expect(summary.objects[0]!.failures.join()).toMatch(/sha256|size/);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("leaves the bucket in place when --keep is set, and that is not a failure", async () => {
    const { dest, calls } = destination();

    const summary = await runRestoreDrill({
      args: args({ keep: true }),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.cleanedUp).toBe(false);
    expect(summary.kept).toBe(true);
    expect(calls.destroyed).toBe(0);
    expect(exitCodeFor(summary)).toBe(0);
  });

  it("fails the drill when the drill objects cannot be removed", async () => {
    const { dest } = destination({ failRemove: true });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    // Content itself verified fine, but copies of production media were left
    // behind — the drill must NOT report success.
    expect(summary.verified).toBe(1);
    expect(summary.mismatches).toBe(0);
    expect(summary.cleanedUp).toBe(false);
    expect(summary.cleanupError).toMatch(/permission denied/);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("fails the drill when the temporary bucket cannot be deleted", async () => {
    const { dest } = destination({ failDestroy: true });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.cleanedUp).toBe(false);
    expect(summary.cleanupError).toMatch(/bucket not empty/);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("fails the drill when the bucket still exists after a 'successful' delete", async () => {
    const { dest } = destination({ bucketSurvivesDestroy: true });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    expect(summary.cleanedUp).toBe(false);
    expect(summary.cleanupError).toMatch(/still exists after cleanup/);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("fails the drill when cleanup cannot be confirmed at all", async () => {
    const { dest } = destination({ failExistsAfterDestroy: true });

    const summary = await runRestoreDrill({
      args: args(),
      source: source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } }),
      destination: dest,
    });

    // An existence check that errors must never be read as "the bucket is gone".
    expect(summary.cleanedUp).toBe(false);
    expect(summary.cleanupError).toMatch(/network down/);
    expect(exitCodeFor(summary)).toBe(1);
  });

  it("cleans up even when the run throws partway", async () => {
    const { dest, calls } = destination();
    const exploding: BackupSource = {
      list: async () => [JPEG_KEY],
      get: async () => {
        throw new Error("R2 unavailable");
      },
    };

    await expect(runRestoreDrill({ args: args(), source: exploding, destination: dest }))
      .rejects.toThrow("R2 unavailable");
    expect(calls.destroyed).toBe(1);
  });

  it("reports BOTH failures when the run throws and cleanup also fails", async () => {
    const { dest } = destination({ failDestroy: true });
    const exploding: BackupSource = {
      list: async () => [JPEG_KEY],
      get: async () => {
        throw new Error("R2 unavailable");
      },
    };

    const error = await runRestoreDrill({ args: args(), source: exploding, destination: dest })
      .catch((caught: unknown) => caught);

    // The original failure must not swallow the fact that a scratch bucket
    // holding production media may still exist.
    expect(error).toBeInstanceOf(RestoreDrillCleanupError);
    const cleanupError = error as RestoreDrillCleanupError;
    expect(cleanupError.message).toContain("R2 unavailable");
    expect(cleanupError.message).toContain("cleanup");
    expect(cleanupError.bucket).toBe(DRILL_BUCKET);
    expect(cleanupError.cleanupError).toMatch(/bucket not empty/);
    expect(cleanupError.cause).toBeInstanceOf(Error);
    expect(exitCodeFor(cleanupError.summary)).toBe(1);
  });

  it("rethrows the original error untouched when cleanup succeeded", async () => {
    const { dest } = destination();
    const exploding: BackupSource = {
      list: async () => [JPEG_KEY],
      get: async () => {
        throw new Error("R2 unavailable");
      },
    };

    const error = await runRestoreDrill({ args: args(), source: exploding, destination: dest })
      .catch((caught: unknown) => caught);

    expect(error).not.toBeInstanceOf(RestoreDrillCleanupError);
    expect((error as Error).message).toBe("R2 unavailable");
  });

  it("refuses to run when the prefix matches nothing", async () => {
    const { dest, calls } = destination();
    await expect(runRestoreDrill({ args: args(), source: source({}), destination: dest }))
      .rejects.toThrow(/No objects found/);
    // Nothing was created, so nothing needs tearing down.
    expect(calls.created).toBe(0);
  });

  it("never writes to the source", async () => {
    const backup = source({ [JPEG_KEY]: { body: jpegBody, contentType: "image/jpeg" } });
    const listSpy = vi.spyOn(backup, "list");
    const getSpy = vi.spyOn(backup, "get");
    const { dest } = destination();

    await runRestoreDrill({ args: args(), source: backup, destination: dest });

    // The BackupSource port only exposes list/get — there is no write path at
    // all — and both were exercised read-only.
    expect(listSpy).toHaveBeenCalledOnce();
    expect(getSpy).toHaveBeenCalledWith(JPEG_KEY);
    expect(Object.keys(backup)).toEqual(["list", "get"]);
  });
});
