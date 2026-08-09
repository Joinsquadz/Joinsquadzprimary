/**
 * Operator-only restore drill: copy a bounded sample of the R2 media backup
 * into an ISOLATED, temporary Supabase Storage bucket, verify the restored
 * objects are byte-, hash- AND content-type-identical to the backup, then
 * delete every drill object and the temporary bucket.
 *
 * Safety model (why this script refuses more than it accepts):
 *   - The destination bucket name MUST start with `restore-drill-`, so a drill
 *     can never be pointed at a bucket that predates the drill.
 *   - The destination MUST NOT equal any configured live bucket
 *     (SUPABASE_STORAGE_BUCKET / SUPABASE_PUBLIC_BUCKET), even if someone names
 *     a live bucket with the drill prefix.
 *   - The destination bucket must NOT already exist unless --reuse-bucket is
 *     passed, so a drill cannot land in someone else's data.
 *   - R2 is only ever read (GET/LIST). The script issues no writes or deletes
 *     against the backup bucket or against live media.
 *
 * Usage (from the project root):
 *   pnpm --filter @workspace/api-server run restore:drill -- \
 *     --prefix "supabase/squadz-avatars/" --bucket restore-drill-<date> --limit 3
 *
 * Flags:
 *   --prefix <r2 prefix>   R2 key prefix to sample (required)
 *   --bucket <name>        Temporary destination bucket, must start with
 *                          `restore-drill-` (required)
 *   --limit <n>            Max objects to restore (default 3)
 *   --keep                 Skip cleanup, leave the drill bucket in place
 *   --reuse-bucket         Allow an existing drill bucket (resumed drill)
 *
 * Exit code is non-zero if ANY object fails verification.
 */

import { createHash } from "node:crypto";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DRILL_BUCKET_PREFIX = "restore-drill-";

export type DrillArgs = {
  prefix: string;
  bucket: string;
  limit: number;
  keep: boolean;
  reuseBucket: boolean;
};

/** Read-only view of the backup. */
export type BackupSource = {
  list: (prefix: string, limit: number) => Promise<string[]>;
  get: (key: string) => Promise<{ body: Buffer; contentType?: string }>;
};

/** The throwaway destination. Every method here touches ONLY the drill bucket. */
export type DrillDestination = {
  exists: () => Promise<boolean>;
  create: () => Promise<void>;
  upload: (key: string, body: Buffer, contentType: string) => Promise<void>;
  download: (key: string) => Promise<{ body: Buffer; contentType?: string }>;
  remove: (keys: string[]) => Promise<void>;
  destroy: () => Promise<void>;
};

export type ObjectResult = {
  key: string;
  ok: boolean;
  sourceBytes: number;
  restoredBytes: number;
  sourceHash: string;
  restoredHash: string;
  sourceContentType: string;
  restoredContentType: string;
  failures: string[];
};

export type DrillSummary = {
  objects: ObjectResult[];
  restoredCount: number;
  sourceBytes: number;
  restoredBytes: number;
  verified: number;
  mismatches: number;
  /** True only when the drill bucket was confirmed GONE after cleanup. */
  cleanedUp: boolean;
  /** True when --keep was requested, so leftover objects are intentional. */
  kept: boolean;
  /** Why cleanup could not be confirmed. Any value here fails the drill. */
  cleanupError?: string;
};

export const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Content types are compared after normalisation because Supabase Storage
 * echoes back a lower-cased type and may append parameters (e.g.
 * `image/jpeg; charset=utf-8`). The *media type* must match exactly; only
 * casing, surrounding whitespace and parameters are ignored.
 */
export function normalizeContentType(value: string | undefined | null): string {
  if (!value) return DEFAULT_CONTENT_TYPE;
  const mediaType = value.split(";")[0]?.trim().toLowerCase();
  return mediaType || DEFAULT_CONTENT_TYPE;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Refuses anything that is not an obviously disposable, non-live destination. */
export function assertScratchDestination(bucket: string): void {
  const live = [
    process.env.SUPABASE_STORAGE_BUCKET ?? "squadz-media",
    process.env.SUPABASE_PUBLIC_BUCKET ?? "squadz-avatars",
  ].map((name) => name.trim().toLowerCase());

  if (live.includes(bucket.trim().toLowerCase())) {
    throw new Error(
      `Refusing to restore into "${bucket}": that is a configured LIVE media bucket. ` +
      "The drill must target a throwaway bucket.",
    );
  }
  if (!bucket.startsWith(DRILL_BUCKET_PREFIX)) {
    throw new Error(
      `Refusing to restore into "${bucket}": drill destinations must start with "${DRILL_BUCKET_PREFIX}".`,
    );
  }
}

/**
 * Strip the backup's `supabase/<bucket>/` or `replit/<bucket>/` routing prefix
 * so the object lands back on its ORIGINAL path inside the destination bucket.
 */
export function destinationKey(r2Key: string): string {
  const parts = r2Key.split("/");
  if ((parts[0] === "supabase" || parts[0] === "replit") && parts.length > 2) {
    return parts.slice(2).join("/");
  }
  return r2Key;
}

/**
 * Compare a restored object against the backup copy. Bytes, hash AND content
 * type must all match — a restore that returns the right bytes under the wrong
 * media type still breaks playback and inline rendering, so it is a failure.
 */
export function verifyRestoredObject(input: {
  key: string;
  sourceBody: Buffer;
  restoredBody: Buffer;
  sourceContentType?: string;
  restoredContentType?: string;
}): ObjectResult {
  const sourceHash = sha256(input.sourceBody);
  const restoredHash = sha256(input.restoredBody);
  const sourceContentType = normalizeContentType(input.sourceContentType);
  const restoredContentType = normalizeContentType(input.restoredContentType);
  const failures: string[] = [];

  if (input.restoredBody.byteLength !== input.sourceBody.byteLength) {
    failures.push(`size ${input.sourceBody.byteLength} -> ${input.restoredBody.byteLength}`);
  }
  if (restoredHash !== sourceHash) {
    failures.push(`sha256 ${sourceHash} -> ${restoredHash}`);
  }
  if (restoredContentType !== sourceContentType) {
    failures.push(`content-type ${sourceContentType} -> ${restoredContentType}`);
  }

  return {
    key: input.key,
    ok: failures.length === 0,
    sourceBytes: input.sourceBody.byteLength,
    restoredBytes: input.restoredBody.byteLength,
    sourceHash,
    restoredHash,
    sourceContentType,
    restoredContentType,
    failures,
  };
}

/**
 * Fails closed. Unverified content AND unconfirmed cleanup are both drill
 * failures: leaving copies of production media in a scratch bucket is exactly
 * the outcome this script exists to avoid, so it must never exit 0.
 */
/**
 * Raised when the drill failed AND its scratch bucket could not be confirmed
 * gone. Carries the bucket name so the CLI can still print the manual-deletion
 * notice — otherwise the original failure would hide the fact that copies of
 * production media are still sitting in the scratch bucket.
 */
export class RestoreDrillCleanupError extends Error {
  readonly cleanupUnconfirmed = true;
  readonly bucket: string;
  readonly cleanupError: string;
  readonly summary: DrillSummary;

  constructor(options: { message: string; bucket: string; cleanupError: string; summary: DrillSummary; cause: unknown }) {
    super(options.message, { cause: options.cause });
    this.name = "RestoreDrillCleanupError";
    this.bucket = options.bucket;
    this.cleanupError = options.cleanupError;
    this.summary = options.summary;
  }
}

export function exitCodeFor(summary: DrillSummary): number {
  if (summary.mismatches > 0) return 1;
  if (!summary.kept && !summary.cleanedUp) return 1;
  return 0;
}

export async function runRestoreDrill(options: {
  args: DrillArgs;
  source: BackupSource;
  destination: DrillDestination;
  log?: (line: string) => void;
}): Promise<DrillSummary> {
  const { args, source, destination } = options;
  const log = options.log ?? (() => {});

  assertScratchDestination(args.bucket);

  const keys = await source.list(args.prefix, args.limit);
  if (!keys.length) throw new Error(`No objects found under prefix "${args.prefix}"`);

  if (await destination.exists()) {
    if (!args.reuseBucket) {
      throw new Error(
        `Bucket "${args.bucket}" already exists. Pass --reuse-bucket only if you are certain it is a drill bucket.`,
      );
    }
  } else {
    await destination.create();
    log(`created temporary private bucket "${args.bucket}"`);
  }

  const summary: DrillSummary = {
    objects: [],
    restoredCount: 0,
    sourceBytes: 0,
    restoredBytes: 0,
    verified: 0,
    mismatches: 0,
    cleanedUp: false,
    kept: false,
  };
  const uploaded: string[] = [];
  let primaryError: unknown;

  try {
    for (const key of keys) {
      const target = destinationKey(key);
      const original = await source.get(key);
      await destination.upload(target, original.body, normalizeContentType(original.contentType));
      uploaded.push(target);
      summary.restoredCount += 1;

      // Read the object back OUT of the destination: only a round-trip proves
      // the restore. A successful upload call proves only that a request was
      // accepted.
      const restored = await destination.download(target);
      const result = verifyRestoredObject({
        key: target,
        sourceBody: original.body,
        restoredBody: restored.body,
        sourceContentType: original.contentType,
        restoredContentType: restored.contentType,
      });

      summary.objects.push(result);
      summary.sourceBytes += result.sourceBytes;
      summary.restoredBytes += result.restoredBytes;
      if (result.ok) summary.verified += 1;
      else summary.mismatches += 1;

      log(`${result.ok ? "OK  " : "FAIL"} ${target}`);
      log(`     bytes ${result.sourceBytes} -> ${result.restoredBytes}`);
      log(`     sha256 ${result.sourceHash}`);
      log(`     sha256 ${result.restoredHash} (restored)`);
      log(`     content-type ${result.sourceContentType} -> ${result.restoredContentType}`);
      for (const failure of result.failures) log(`     MISMATCH: ${failure}`);
    }
  } catch (error) {
    // Held rather than rethrown so cleanup always runs AND a cleanup failure
    // can be reported alongside it instead of being lost.
    primaryError = error;
  }

  {
    if (args.keep) {
      summary.kept = true;
      log(`--keep set: leaving "${args.bucket}" in place. Delete it when finished.`);
    } else {
      // Cleanup is part of the drill's contract, not best-effort housekeeping:
      // a failure here means copies of production media are still sitting in the
      // scratch bucket, so it is recorded and it fails the run.
      try {
        if (uploaded.length) await destination.remove(uploaded);
        await destination.destroy();
        summary.cleanedUp = !(await destination.exists());
        if (!summary.cleanedUp) {
          summary.cleanupError = `bucket "${args.bucket}" still exists after cleanup`;
        }
      } catch (error) {
        summary.cleanedUp = false;
        summary.cleanupError = error instanceof Error ? error.message : String(error);
      }
      log(
        summary.cleanedUp
          ? `removed ${uploaded.length} drill object(s); bucket deleted and confirmed gone`
          : `CLEANUP FAILED — delete "${args.bucket}" by hand: ${summary.cleanupError}`,
      );
    }
  }

  if (primaryError) {
    // A cleanup failure must not be swallowed by the original error: surface
    // both, so the manual-deletion notice still reaches the operator.
    if (summary.cleanupError) {
      const original = primaryError instanceof Error ? primaryError.message : String(primaryError);
      throw new RestoreDrillCleanupError({
        message: `${original} — additionally, cleanup of "${args.bucket}" could not be confirmed: ${summary.cleanupError}`,
        bucket: args.bucket,
        cleanupError: summary.cleanupError,
        summary,
        cause: primaryError,
      });
    }
    throw primaryError;
  }

  return summary;
}

// ── Real adapters + CLI ──────────────────────────────────────────────────────

export function parseArgs(argv: string[]): DrillArgs {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const prefix = get("--prefix");
  const bucket = get("--bucket");
  if (!prefix) throw new Error("Missing --prefix <r2 key prefix>");
  if (!bucket) throw new Error("Missing --bucket <temporary destination bucket>");
  return {
    prefix,
    bucket,
    limit: Number(get("--limit") ?? 3),
    keep: argv.includes("--keep"),
    reuseBucket: argv.includes("--reuse-bucket"),
  };
}

/**
 * Built as a standalone bundle, so this deliberately creates its own client
 * instead of importing ../services/supabase — that module pulls in the app
 * logger, whose pino transport worker cannot resolve outside the server bundle.
 */
function supabaseAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function r2Source(client: S3Client, backupBucket: string): BackupSource {
  return {
    async list(prefix, limit) {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: backupBucket,
        Prefix: prefix,
        MaxKeys: limit,
      }));
      return (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key) && !key!.endsWith("/"));
    },
    async get(key) {
      const got = await client.send(new GetObjectCommand({ Bucket: backupBucket, Key: key }));
      return {
        body: Buffer.from(await got.Body!.transformToByteArray()),
        contentType: got.ContentType,
      };
    },
  };
}

/**
 * Absence is proven ONLY by an explicit 404. Message text is deliberately not
 * consulted: an auth or network failure whose message happens to contain "not
 * found" would otherwise be read as "the bucket is gone", letting a drill claim
 * confirmed cleanup while scratch copies of production media survive.
 */
export function isBucketNotFound(error: {
  message?: string;
  status?: number | string;
  statusCode?: string | number;
}): boolean {
  // Observed shape for a genuinely missing bucket: StorageApiError with
  // `status: 400` (number) but `statusCode: "404"` (string). The 404 therefore
  // has to be honoured from EITHER field — but still only from a status field,
  // never from the message.
  const asStatus = (value: number | string | undefined): number | undefined => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value, 10);
    return undefined;
  };
  return asStatus(error.status) === 404 || asStatus(error.statusCode) === 404;
}

export function supabaseDrillBucket(admin: SupabaseClient, bucket: string): DrillDestination {
  return {
    async exists() {
      const { data, error } = await admin.storage.getBucket(bucket);
      if (data) return true;
      // Absence is concluded ONLY from an explicit 404. Every other outcome —
      // another error, or the ambiguous "no data and no error" response — is
      // unknown, and unknown must never be reported as "the bucket is gone":
      // that would let a failed check pass as confirmed cleanup (or allow
      // creating over a bucket that already exists).
      if (error) {
        if (isBucketNotFound(error)) return false;
        throw new Error(`Could not determine whether "${bucket}" exists: ${error.message}`);
      }
      throw new Error(
        `Could not determine whether "${bucket}" exists: Supabase returned neither bucket data nor an error.`,
      );
    },
    async create() {
      const { error } = await admin.storage.createBucket(bucket, { public: false });
      if (error) throw new Error(`Could not create drill bucket: ${error.message}`);
    },
    async upload(key, body, contentType) {
      const { error } = await admin.storage.from(bucket).upload(key, body, { contentType, upsert: true });
      if (error) throw new Error(`Upload failed for ${key}: ${error.message}`);
    },
    async download(key) {
      const { data, error } = await admin.storage.from(bucket).download(key);
      if (error || !data) throw new Error(`Verification download failed for ${key}: ${error?.message}`);
      return { body: Buffer.from(await data.arrayBuffer()), contentType: data.type };
    },
    async remove(keys) {
      const { error } = await admin.storage.from(bucket).remove(keys);
      if (error) throw new Error(`Could not remove drill objects: ${error.message}`);
    },
    async destroy() {
      const { error: emptyError } = await admin.storage.emptyBucket(bucket);
      if (emptyError) throw new Error(`Could not empty drill bucket: ${emptyError.message}`);
      const { error } = await admin.storage.deleteBucket(bucket);
      if (error) throw new Error(`Could not delete drill bucket: ${error.message}`);
    },
  };
}

function r2Client(): S3Client {
  for (const key of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BACKUP_BUCKET"]) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertScratchDestination(args.bucket);

  const admin = supabaseAdminClient();
  if (!admin) throw new Error("Supabase service-role credentials are not configured");
  const backupBucket = process.env.R2_BACKUP_BUCKET!;

  console.log("── Restore drill ─────────────────────────────────────────────");
  console.log(`source (read-only): r2://${backupBucket}/${args.prefix}`);
  console.log(`destination (temporary): supabase://${args.bucket}`);
  console.log(`limit: ${args.limit}\n`);

  const summary = await runRestoreDrill({
    args,
    source: r2Source(r2Client(), backupBucket),
    destination: supabaseDrillBucket(admin, args.bucket),
    log: (line) => console.log(line),
  });

  console.log("\n── Verification ─────────────────────────────────────────────");
  console.log(`objects restored : ${summary.restoredCount}`);
  console.log(`source bytes     : ${summary.sourceBytes}`);
  console.log(`restored bytes   : ${summary.restoredBytes}`);
  console.log(`fully verified   : ${summary.verified} (bytes + sha256 + content-type)`);
  console.log(`mismatches       : ${summary.mismatches}`);
  if (!args.keep) {
    console.log(`cleanup confirmed: ${summary.cleanedUp ? "bucket no longer exists" : "NO — " + summary.cleanupError}`);
    if (!summary.cleanedUp) {
      console.error(`\nACTION REQUIRED: delete the bucket "${args.bucket}" by hand; it still holds copies of production media.`);
    }
  }

  process.exitCode = exitCodeFor(summary);
}

// Only run the CLI when executed directly, so tests can import the helpers.
if (process.env.VITEST === undefined) {
  main().catch((error) => {
    console.error(`\nrestore drill failed: ${error instanceof Error ? error.message : String(error)}`);
    // The drill may have failed *and* left scratch copies of production media
    // behind; that notice must survive the original error.
    if (error instanceof RestoreDrillCleanupError) {
      console.error(`\nACTION REQUIRED: delete the bucket "${error.bucket}" by hand; it may still hold copies of production media.`);
    }
    process.exit(1);
  });
}
