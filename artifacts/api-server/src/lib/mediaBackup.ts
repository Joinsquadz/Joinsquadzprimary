import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Readable } from "node:stream";
import { pool } from "@workspace/db";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";
import { supabaseAdmin } from "../services/supabase";
import { captureMessage } from "../services/monitoring";

const SUPABASE_PRIVATE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "squadz-media";
const SUPABASE_PUBLIC_BUCKET = process.env.SUPABASE_PUBLIC_BUCKET ?? "squadz-avatars";
const LOCK_KEY = 4_027_417_913;
const PAGE_SIZE = 100;

export type MediaBackupSummary = {
  startedAt: string;
  finishedAt: string;
  skipped: boolean;
  sources: string[];
  checked: number;
  copied: number;
  copiedBytes: number;
  failures: number;
};

type SourceObject = {
  key: string;
  size: number;
  contentType?: string;
  // Must resolve to a Buffer or a Node Readable. A web ReadableStream is NOT
  // usable here: the S3 client then falls back to aws-chunked encoding and
  // sends an undefined x-amz-decoded-content-length, which R2 rejects.
  read: () => Promise<Buffer | Readable>;
};

type BackupSource = {
  label: string;
  prefix: string;
  list: () => AsyncGenerator<SourceObject>;
};

function configured(): boolean {
  return Boolean(
    supabaseAdmin &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_ENDPOINT &&
    process.env.R2_BACKUP_BUCKET,
  );
}

function r2(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

function legacyObjectSources(): BackupSource[] {
  const paths = [
    process.env.PRIVATE_OBJECT_DIR,
    ...(process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "").split(","),
  ]
    .map((path) => path?.trim())
    .filter((path): path is string => Boolean(path));

  return [...new Set(paths)].flatMap((path) => {
    const [bucket, ...prefixParts] = path.replace(/^\/+/, "").split("/");
    const prefix = prefixParts.filter(Boolean).join("/");
    if (!bucket) return [];
    // GCS `file.name` ALREADY contains the search prefix, so the R2 prefix must
    // be the bucket alone — including it twice produced keys like
    // `replit/<bucket>/.private/.private/uploads/...`.
    const targetPrefix = `replit/${bucket}/`;

    return [{
      label: `replit:${bucket}${prefix ? `/${prefix}` : ""}`,
      prefix: targetPrefix,
      async *list(): AsyncGenerator<SourceObject> {
        let pageToken: string | undefined;
        do {
          const [files, , response] = await objectStorageClient
            .bucket(bucket)
            .getFiles({ prefix: prefix || undefined, autoPaginate: false, pageToken });
          pageToken = (response as { nextPageToken?: string } | undefined)?.nextPageToken;
          for (const file of files) {
            // Folder placeholders (keys ending in "/") are not real media.
            if (file.name.endsWith("/")) continue;
            const [metadata] = await file.getMetadata();
            yield {
              key: file.name,
              size: Number(metadata.size ?? 0),
              contentType: metadata.contentType,
              read: async () => file.createReadStream(),
            };
          }
        } while (pageToken);
      },
    }];
  });
}

function supabaseSource(bucket: string): BackupSource {
  return {
    label: `supabase:${bucket}`,
    prefix: `supabase/${bucket}/`,
    async *list(): AsyncGenerator<SourceObject> {
      async function* walk(prefix = ""): AsyncGenerator<SourceObject> {
        let offset = 0;
        while (true) {
          const { data, error } = await supabaseAdmin!.storage.from(bucket).list(prefix, {
            limit: PAGE_SIZE,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
          if (error) throw new Error(`Could not list Supabase bucket ${bucket}: ${error.message}`);
          if (!data?.length) break;

          for (const item of data) {
            const objectKey = `${prefix}${item.name}`;
            if (!item.id) {
              yield* walk(`${objectKey}/`);
              continue;
            }
            const metadata = item.metadata as Record<string, unknown> | null;
            const size = Number(metadata?.["size"] ?? metadata?.["Content-Length"] ?? 0);
            const contentType = (item.metadata as { mimetype?: string } | null)?.mimetype;
            yield {
              key: objectKey,
              size,
              contentType,
              read: async () => {
                const { data: blob, error: downloadError } = await supabaseAdmin!.storage
                  .from(bucket)
                  .download(objectKey);
                if (downloadError || !blob) {
                  throw new Error(`Could not download ${bucket}/${objectKey}: ${downloadError?.message ?? "empty response"}`);
                }
                // download() already materialises the whole object, so a
                // Buffer costs no extra memory and gives the S3 client a
                // known length.
                return Buffer.from(await blob.arrayBuffer());
              },
            };
          }
          if (data.length < PAGE_SIZE) break;
          offset += data.length;
        }
      }
      yield* walk();
    },
  };
}

function sources(): BackupSource[] {
  return [
    supabaseSource(SUPABASE_PRIVATE_BUCKET),
    ...(SUPABASE_PUBLIC_BUCKET === SUPABASE_PRIVATE_BUCKET ? [] : [supabaseSource(SUPABASE_PUBLIC_BUCKET)]),
    ...legacyObjectSources(),
  ];
}

async function alreadyBackedUp(client: S3Client, key: string, size: number): Promise<boolean> {
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: process.env.R2_BACKUP_BUCKET!, Key: key }));
    return Number(result.ContentLength ?? -1) === size;
  } catch (error: unknown) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

export async function runMediaBackup(): Promise<MediaBackupSummary> {
  const startedAt = new Date().toISOString();
  const allSources = sources();
  const summary: MediaBackupSummary = {
    startedAt,
    finishedAt: startedAt,
    skipped: false,
    sources: allSources.map((source) => source.label),
    checked: 0,
    copied: 0,
    copiedBytes: 0,
    failures: 0,
  };

  if (!configured()) {
    summary.skipped = true;
    logger.warn({ sources: summary.sources }, "[media-backup] skipped: Supabase or R2 configuration missing");
    return { ...summary, finishedAt: new Date().toISOString() };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query("BEGIN");
    const lockResult = await dbClient.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [LOCK_KEY],
    );
    if (!lockResult.rows[0]?.locked) {
      summary.skipped = true;
      logger.info("[media-backup] skipped: another instance holds the backup lock");
      return summary;
    }

    const client = r2();
    for (const source of allSources) {
      try {
        for await (const object of source.list()) {
          summary.checked += 1;
          const key = `${source.prefix}${object.key}`;
          try {
            if (await alreadyBackedUp(client, key, object.size)) continue;
            const body = await object.read();
            // ContentLength is REQUIRED: without it the SDK switches to
            // aws-chunked streaming and R2 rejects the request.
            const contentLength = Buffer.isBuffer(body) ? body.byteLength : object.size;
            await client.send(new PutObjectCommand({
              Bucket: process.env.R2_BACKUP_BUCKET!,
              Key: key,
              Body: body,
              ContentLength: contentLength,
              ContentType: object.contentType,
              Metadata: { "source-size": String(object.size), "source-key": object.key },
            }));
            summary.copied += 1;
            summary.copiedBytes += contentLength;
          } catch (error) {
            summary.failures += 1;
            logger.warn({ err: error, source: source.label, key }, "[media-backup] object copy failed");
          }
        }
      } catch (error) {
        summary.failures += 1;
        logger.warn({ err: error, source: source.label }, "[media-backup] source listing failed");
      }
    }

    summary.finishedAt = new Date().toISOString();
    logger.info(summary, "[media-backup] completed");
    if (summary.failures > 0) {
      captureMessage(
        `Media backup completed with ${summary.failures} failure(s); copied ${summary.copied}/${summary.checked} checked objects`,
        "warning",
      );
    }
    return summary;
  } catch (error) {
    logger.warn({ err: error }, "[media-backup] run failed");
    captureMessage("Media backup failed before completion", "warning");
    throw error;
  } finally {
    await dbClient.query("ROLLBACK").catch(() => undefined);
    dbClient.release();
  }
}

export function scheduleMediaBackup(): void {
  const hour = 3;
  const minute = 30;
  const timezone = "America/New_York";
  let lastRunDay = "";
  const check = () => {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    const day = `${value("year")}-${value("month")}-${value("day")}`;
    if (Number(value("hour")) !== hour || Number(value("minute")) !== minute || lastRunDay === day) return;
    lastRunDay = day;
    runMediaBackup().catch((error) => logger.warn({ err: error }, "[media-backup] scheduled run failed"));
  };
  logger.info({ timezone, hour, minute }, "[media-backup] scheduled nightly");
  setInterval(check, 60_000).unref();
  check();
}