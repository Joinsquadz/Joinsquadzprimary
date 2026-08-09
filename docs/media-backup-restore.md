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