/**
 * Account-deletion media cleanup.
 *
 * The invariants under test, in order of severity:
 *   1. SAFETY — user A's deletion must never touch user B's media, even though
 *      both live in the same flat `uploads/` namespace.
 *   2. SAFETY — an external avatar URL (Google/Apple/CDN) is never deleted.
 *   3. Completeness — owned private objects, the app-owned public avatar, and
 *      the matching R2 backup copies all go.
 *   4. Durability — storage failures are queued for retry and reported, not
 *      swallowed; the retry worker clears the ones that later succeed and gives
 *      up loudly at the attempt cap.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_STORAGE_BUCKET = "squadz-media";
  process.env.SUPABASE_PUBLIC_BUCKET = "squadz-avatars";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_ENDPOINT = "https://r2.example.com";
  process.env.R2_BACKUP_BUCKET = "squadz-backup";
});

const mockPoolQuery = vi.hoisted(() => vi.fn());
const mockRemove = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockCaptureMessage = vi.hoisted(() => vi.fn());
const mockCaptureException = vi.hoisted(() => vi.fn());

const { DeleteObjectsCommand } = vi.hoisted(() => ({
  DeleteObjectsCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  DeleteObjectsCommand,
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock("../services/supabase", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        remove: (keys: string[]) => mockRemove(bucket, keys),
      }),
    },
  },
}));

vi.mock("../services/monitoring", () => ({
  captureMessage: mockCaptureMessage,
  captureException: mockCaptureException,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  backupKeyFor,
  collectAccountMediaTargets,
  deleteAccountMedia,
  parsePrivateObjectKey,
  parsePublicAvatarKey,
  retryPendingAccountMediaCleanup,
  MAX_CLEANUP_ATTEMPTS,
} from "../lib/accountMediaCleanup";

const AVATAR_URL =
  "https://proj.supabase.co/storage/v1/object/public/squadz-avatars/uploads/avatar-a.jpg";

/** Every deletion path reports success unless a test overrides it. */
function happyPath() {
  mockRemove.mockResolvedValue({ data: [], error: null });
  mockSend.mockResolvedValue({ Errors: [] });
}

/** object_uploads SELECT returns `rows`; every other query is a no-op write. */
function ownedUploads(rows: Array<{ object_path: string }>) {
  mockPoolQuery.mockImplementation((text: string) => {
    if (text.includes("FROM object_uploads")) return Promise.resolve({ rows });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
  ownedUploads([]);
});

// ── Ownership parsing ────────────────────────────────────────────────────────

describe("ownership parsing", () => {
  it("accepts a private Supabase object path and rejects legacy / malicious ones", () => {
    expect(parsePrivateObjectKey("/objects/supabase/uploads/a.jpg")).toBe("uploads/a.jpg");
    expect(parsePrivateObjectKey("/objects/uploads/a.jpg")).toBeNull();
    expect(parsePrivateObjectKey("/objects/supabase/../../etc/passwd")).toBeNull();
    expect(parsePrivateObjectKey("")).toBeNull();
    expect(parsePrivateObjectKey(null)).toBeNull();
  });

  it("accepts only app-owned public avatar URLs", () => {
    expect(parsePublicAvatarKey(AVATAR_URL)).toBe("uploads/avatar-a.jpg");
    // Different Supabase host — not our project.
    expect(
      parsePublicAvatarKey(
        "https://evil.supabase.co/storage/v1/object/public/squadz-avatars/uploads/x.jpg",
      ),
    ).toBeNull();
    // Right host, wrong bucket.
    expect(
      parsePublicAvatarKey(
        "https://proj.supabase.co/storage/v1/object/public/other-bucket/uploads/x.jpg",
      ),
    ).toBeNull();
    // Provider avatars must never be parsed as deletable.
    expect(parsePublicAvatarKey("https://lh3.googleusercontent.com/a/abc123")).toBeNull();
    expect(parsePublicAvatarKey("not a url")).toBeNull();
    expect(parsePublicAvatarKey(null)).toBeNull();
  });

  it("derives the R2 backup key exactly as the backup writer does", () => {
    expect(backupKeyFor({ store: "supabase", bucket: "squadz-media", key: "uploads/a.jpg" })).toBe(
      "supabase/squadz-media/uploads/a.jpg",
    );
  });
});

// ── Collection ───────────────────────────────────────────────────────────────

describe("collectAccountMediaTargets", () => {
  it("collects owned private objects plus the app-owned avatar", async () => {
    ownedUploads([
      { object_path: "/objects/supabase/uploads/a1.jpg" },
      { object_path: "/objects/supabase/uploads/a2.mp4" },
    ]);

    const collected = await collectAccountMediaTargets("user-a", AVATAR_URL);

    expect(collected.targets).toEqual([
      { store: "supabase", bucket: "squadz-media", key: "uploads/a1.jpg" },
      { store: "supabase", bucket: "squadz-media", key: "uploads/a2.mp4" },
      { store: "supabase", bucket: "squadz-avatars", key: "uploads/avatar-a.jpg" },
    ]);
    expect(collected.skippedExternalAvatar).toBe(false);
    // Scoped by owner — never a path prefix sweep.
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("owner_id = $1"), ["user-a"]);
  });

  it("leaves an external provider avatar alone and flags it", async () => {
    const collected = await collectAccountMediaTargets(
      "user-a",
      "https://lh3.googleusercontent.com/a/abc123",
    );
    expect(collected.targets).toEqual([]);
    expect(collected.skippedExternalAvatar).toBe(true);
  });

  it("counts legacy (non-Supabase) object paths instead of guessing at them", async () => {
    ownedUploads([{ object_path: "/objects/uploads/legacy-1.jpg" }]);
    const collected = await collectAccountMediaTargets("user-a", null);
    expect(collected.targets).toEqual([]);
    expect(collected.skippedLegacy).toBe(1);
  });
});

// ── Deletion ─────────────────────────────────────────────────────────────────

describe("deleteAccountMedia", () => {
  it("deletes owned Supabase objects and their R2 backup copies", async () => {
    ownedUploads([{ object_path: "/objects/supabase/uploads/a1.jpg" }]);
    const collected = await collectAccountMediaTargets("user-a", AVATAR_URL);

    const summary = await deleteAccountMedia("user-a", collected);

    expect(mockRemove).toHaveBeenCalledWith("squadz-media", ["uploads/a1.jpg"]);
    expect(mockRemove).toHaveBeenCalledWith("squadz-avatars", ["uploads/avatar-a.jpg"]);

    const r2Keys = mockSend.mock.calls
      .flatMap((call) => (call[0].input.Delete.Objects as Array<{ Key: string }>))
      .map((o) => o.Key);
    expect(r2Keys.sort()).toEqual([
      "supabase/squadz-avatars/uploads/avatar-a.jpg",
      "supabase/squadz-media/uploads/a1.jpg",
    ]);

    expect(summary).toMatchObject({ targets: 2, supabaseDeleted: 2, r2Deleted: 2, failed: 0 });
  });

  it("SAFETY: deleting user A never touches user B's media", async () => {
    // Both users own objects in the SAME flat `uploads/` namespace; only A's
    // provenance rows come back for A.
    const uploads: Record<string, Array<{ object_path: string }>> = {
      "user-a": [{ object_path: "/objects/supabase/uploads/a1.jpg" }],
      "user-b": [{ object_path: "/objects/supabase/uploads/b1.jpg" }],
    };
    mockPoolQuery.mockImplementation((text: string, values?: unknown[]) => {
      if (text.includes("FROM object_uploads")) {
        return Promise.resolve({ rows: uploads[values?.[0] as string] ?? [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const collected = await collectAccountMediaTargets(
      "user-a",
      // B's avatar sits in the same public bucket; A's row carries A's URL only.
      AVATAR_URL,
    );
    await deleteAccountMedia("user-a", collected);

    const allSupabaseKeys = mockRemove.mock.calls.flatMap((call) => call[1] as string[]);
    const allR2Keys = mockSend.mock.calls
      .flatMap((call) => (call[0].input.Delete.Objects as Array<{ Key: string }>))
      .map((o) => o.Key);

    expect(allSupabaseKeys).toContain("uploads/a1.jpg");
    expect(allSupabaseKeys).not.toContain("uploads/b1.jpg");
    expect(allSupabaseKeys.some((k) => k.includes("b1"))).toBe(false);
    expect(allR2Keys.some((k) => k.includes("b1"))).toBe(false);
    // And no prefix-wide delete slipped in.
    expect(allSupabaseKeys).not.toContain("uploads/");
  });

  it("does nothing when the account owns no app media", async () => {
    const summary = await deleteAccountMedia("user-a", {
      targets: [],
      skippedLegacy: 0,
      skippedExternalAvatar: false,
    });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(summary.targets).toBe(0);
  });

  it("queues a retry and reports to Sentry when Supabase deletion fails", async () => {
    ownedUploads([{ object_path: "/objects/supabase/uploads/a1.jpg" }]);
    mockRemove.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    const collected = await collectAccountMediaTargets("user-a", null);

    const summary = await deleteAccountMedia("user-a", collected);

    expect(summary.failed).toBe(1);
    expect(summary.supabaseDeleted).toBe(0);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("undeleted"),
      "error",
    );
    const enqueue = mockPoolQuery.mock.calls.find(([text]) =>
      String(text).includes("INSERT INTO account_media_cleanup"),
    );
    expect(enqueue).toBeDefined();
    expect(enqueue?.[1]).toEqual(
      expect.arrayContaining(["user-a", "supabase", "squadz-media", "uploads/a1.jpg"]),
    );
  });

  it("never throws — a total storage outage still resolves with a queued summary", async () => {
    ownedUploads([{ object_path: "/objects/supabase/uploads/a1.jpg" }]);
    mockRemove.mockRejectedValue(new Error("network down"));
    mockSend.mockRejectedValue(new Error("network down"));
    const collected = await collectAccountMediaTargets("user-a", null);

    await expect(deleteAccountMedia("user-a", collected)).resolves.toMatchObject({
      failed: 2, // the Supabase object + its R2 backup copy
    });
  });
});

// ── Retry worker ─────────────────────────────────────────────────────────────

describe("retryPendingAccountMediaCleanup", () => {
  function queued(rows: Array<Record<string, unknown>>) {
    mockPoolQuery.mockImplementation((text: string) => {
      if (text.includes("FROM account_media_cleanup")) return Promise.resolve({ rows });
      return Promise.resolve({ rows: [] });
    });
  }

  it("clears rows that succeed on retry", async () => {
    queued([
      {
        id: "row-1",
        user_id: "user-a",
        store: "supabase",
        bucket: "squadz-media",
        object_key: "uploads/a1.jpg",
        attempts: 1,
      },
    ]);

    const result = await retryPendingAccountMediaCleanup();

    expect(mockRemove).toHaveBeenCalledWith("squadz-media", ["uploads/a1.jpg"]);
    expect(result).toMatchObject({ attempted: 1, deleted: 1, failed: 0, abandoned: 0 });
    expect(
      mockPoolQuery.mock.calls.some(
        ([text, values]) =>
          String(text).includes("DELETE FROM account_media_cleanup") &&
          (values as unknown[])?.[0] === "row-1",
      ),
    ).toBe(true);
  });

  it("reschedules with backoff when the retry fails again", async () => {
    queued([
      {
        id: "row-1",
        user_id: "user-a",
        store: "supabase",
        bucket: "squadz-media",
        object_key: "uploads/a1.jpg",
        attempts: 1,
      },
    ]);
    mockRemove.mockResolvedValue({ data: null, error: { message: "still down" } });

    const result = await retryPendingAccountMediaCleanup();

    expect(result).toMatchObject({ deleted: 0, failed: 1, abandoned: 0 });
    const update = mockPoolQuery.mock.calls.find(([text]) =>
      String(text).includes("UPDATE account_media_cleanup"),
    );
    expect(update?.[1]).toEqual(["row-1", 2, "still down", "10"]);
  });

  it("gives up loudly at the attempt cap instead of retrying forever", async () => {
    queued([
      {
        id: "row-1",
        user_id: "user-a",
        store: "r2",
        bucket: "squadz-backup",
        object_key: "supabase/squadz-media/uploads/a1.jpg",
        attempts: MAX_CLEANUP_ATTEMPTS - 1,
      },
    ]);
    mockSend.mockResolvedValue({
      Errors: [{ Key: "supabase/squadz-media/uploads/a1.jpg", Message: "AccessDenied" }],
    });

    const result = await retryPendingAccountMediaCleanup();

    expect(result.abandoned).toBe(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("manual deletion required"),
      "error",
    );
  });

  it("is a no-op when the queue is empty", async () => {
    queued([]);
    const result = await retryPendingAccountMediaCleanup();
    expect(result).toEqual({ attempted: 0, deleted: 0, failed: 0, abandoned: 0 });
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
