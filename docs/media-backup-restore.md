# Media backup restore

The nightly media backup stores an independent copy in Cloudflare R2. It runs at
**03:30 America/New_York** (the app's primary timezone — after evening plan
activity, before morning traffic) and takes a Postgres advisory lock so exactly
one autoscale instance performs the copy.

Source bucket and object paths are preserved in the R2 key:

- `supabase/Squadz storage bucket/<path>` — private user media (Moments, Vault,
  Feed, chat attachments). The bucket name comes from `SUPABASE_STORAGE_BUCKET`
  and really does contain spaces; quote it in any CLI command.
- `supabase/squadz-avatars/<path>` — public profile avatars
  (`SUPABASE_PUBLIC_BUCKET`).
- `replit/<bucket>/<path>` — legacy Replit Object Storage, covering
  `PRIVATE_OBJECT_DIR` and `PUBLIC_OBJECT_SEARCH_PATHS` when configured.

Buckets are read from env at startup, so adding a bucket means updating those
variables — the job iterates over whatever they resolve to.

## Manual run

```bash
curl -X POST "$APP_URL/api/internal/media-backup" \
  -H "Authorization: Bearer $INTERNAL_API_TOKEN"
```

It responds with the run summary (`checked`, `copied`, `copiedBytes`,
`failures`, `sources`). The job is incremental: an object is skipped when a key
of the same size already exists in R2, so re-running is cheap and safe.
Failures are logged per object and reported to Sentry at warning level.

## Backup freshness (dead-man switch)

A run that finishes with **zero failures** records `last_success_at` in the
single-row `media_backup_status` table. A partial run never advances it, so a
half-working backup can't look healthy.

A check runs at startup and every six hours. If no clean run has completed
within **36 hours** (one nightly run, plus a full missed run before anyone is
paged), it logs a warning and raises a Sentry warning. The alert fires once per
outage — it re-arms only after a clean run — so an ongoing incident does not
flood the channel.

`GET /api/internal/health` (internal bearer token) reports `mediaBackup` with
`lastSuccessAt`, `ageMs`, `stale`, and `thresholdHours`. No bucket names,
object paths, or credentials are included.

## Restore drill (safe, repeatable)

`restore:drill` restores a bounded sample from R2 into a throwaway Supabase
bucket, verifies it, and deletes the bucket:

```bash
pnpm --filter @workspace/api-server run restore:drill -- \
  --prefix "supabase/squadz-avatars/" --bucket restore-drill-<date> --limit 3
```

It refuses to run unless the destination starts with `restore-drill-` and is
not a configured live bucket, and it refuses a pre-existing bucket unless
`--reuse-bucket` is passed. R2 is only ever read. Objects are written back to
their original paths (the `supabase/<bucket>/` or `replit/<bucket>/` routing
prefix is stripped), then read back OUT of the destination and compared on
**bytes, SHA-256 and content type**. All three must match: bytes served under
the wrong media type still break playback and inline rendering, so that counts
as a failed restore. Content types are compared case-insensitively and ignoring
parameters (`image/jpeg; charset=utf-8` matches `image/jpeg`), but the media
type itself must be identical.

Cleanup is part of the contract, not best-effort housekeeping. The drill deletes
the objects and the temporary bucket, then re-confirms the bucket is gone.
**The drill exits non-zero for unverified content OR unconfirmed cleanup**, and
prints the bucket name to delete by hand if anything is left behind — an
abandoned drill bucket is an unmanaged copy of production media. Absence is only
ever concluded from an explicit 404, never from error text, so a failed check
can't masquerade as a clean teardown.

Pass `--keep` to inspect the restored objects before cleanup (leftovers are then
intentional and do not fail the run); delete the bucket yourself afterwards.

### Last drill: 2026-08-09

Command: `--prefix "supabase/squadz-avatars/" --bucket restore-drill-20260809b --limit 3`

| Measure | Result |
| --- | --- |
| Objects restored | 3 |
| Source bytes | 1,156,861 |
| Restored bytes | 1,156,861 |
| Fully verified (bytes + SHA-256 + content type) | 3 |
| Mismatches | 0 |
| Exit code | 0 |

Sampled objects (`uploads/78317644-…jpeg`, `uploads/a050db10-…jpeg`,
`uploads/feebd54b-…jpeg`) each round-tripped with an identical SHA-256 and
`image/jpeg` intact.

Guard checks confirmed the same day: the drill refused
`"$SUPABASE_STORAGE_BUCKET"` and `squadz-avatars` as live buckets, and
`some-other-bucket` for not being a scratch name.

Cleanup: all 3 drill objects removed, bucket `restore-drill-20260809` deleted,
and its absence re-confirmed by the script. No live media was read for writing,
modified, published, or used as a destination.

## Before restoring

1. Pause writes to the affected media source if possible. This avoids restoring
   an older copy over newly uploaded content.
2. Use credentials with read access to the R2 backup bucket and the appropriate
   write access to the destination (Supabase service-role credentials for
   Supabase Storage, or the existing Replit Object Storage configuration).
3. First restore a small, isolated prefix to a non-production bucket and verify
   object count, byte size, MIME types, and application rendering.

## Restore to Supabase Storage

1. List the selected R2 prefix, for example `supabase/squadz-media/uploads/`.
2. For every R2 object, remove the `supabase/<bucket>/` prefix to get its
   destination key.
3. Download the object from R2 and upload the bytes to the matching Supabase
   bucket and destination key. Preserve the original `Content-Type` metadata.
4. Verify object count and total bytes at both ends. Spot-check signed private
   URLs and direct public avatar URLs in the application.

An S3-compatible tool can perform the download side. Use a Supabase service-role
script or dashboard upload for the destination. Do **not** make the private media
bucket public during recovery.

## Restore legacy Replit Object Storage

For keys under `replit/<bucket>/`, remove that first two-segment prefix and write
the remaining object path into the named Replit bucket. Use the app’s existing
Object Storage sidecar credentials and preserve content type metadata. Verify the
same count/byte totals and protected-object ACL behavior before reopening writes.

## After restoring

1. Re-enable media writes.
2. Run `POST /api/internal/media-backup` with the internal bearer token. It is
   incremental, so restored objects already matching the backup are not copied
   again.
3. Record the incident scope and verification results in the operational log.