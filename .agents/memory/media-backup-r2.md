---
name: Media backup to Cloudflare R2
description: Gotchas for the nightly Supabase Storage -> R2 media backup — real bucket names, required ContentLength on PutObject, and key-prefix rules.
---

# Nightly media backup (Supabase Storage + legacy Replit Object Storage -> R2)

## The private media bucket is named "Squadz storage bucket" (with spaces)

`SUPABASE_STORAGE_BUCKET` resolves to the literal string `Squadz storage bucket`,
NOT the `squadz-media` default in code. The public one is `squadz-avatars`.

**Why:** the bucket was created with a display-style name, so any code that
assumes the default constant silently targets a bucket that does not exist.

**How to apply:** never hardcode `squadz-media`; read the env var. In tests, pin
bucket names via `vi.hoisted()` before importing the module under test — the
module reads env at load time, so the deployed value otherwise leaks into
assertions. Quote the name in any CLI/S3 command (it contains spaces).

## S3/R2 PutObject MUST get a known body length

Passing a web `ReadableStream` (e.g. from `Blob.stream()`) with no
`ContentLength` makes the AWS SDK fall back to aws-chunked encoding and send
`x-amz-decoded-content-length: undefined`; every upload then dies with
`ERR_HTTP_INVALID_HEADER_VALUE` before it reaches R2.

**Why:** the SDK can only skip chunked encoding when it knows the length up
front; R2 rejects the malformed header.

**How to apply:** hand the SDK a `Buffer` or a Node `Readable` AND pass an
explicit `ContentLength`. Supabase `download()` already materialises the whole
object, so `Buffer.from(await blob.arrayBuffer())` costs no extra memory.

## GCS `file.name` already contains the search prefix

Building an R2 key as `replit/<bucket>/<prefix>/` + `file.name` double-prefixes
it (`.private/.private/uploads/...`). Prefix with the bucket only. Also skip
keys ending in `/` — those are folder placeholders, not media.

## Design invariants worth keeping

- Incremental: skip when a key of the same size already exists in R2 (HEAD, and
  treat a 404 as "not backed up"). A second run must copy 0.
- Exactly one instance copies per night: `pg_try_advisory_xact_lock` on a
  dedicated pooled connection, held for the run, rolled back at the end. A lost
  lock is a skip, not an error.
- Per-object failures are counted and logged but never abort the run; a run with
  failures raises a Sentry warning so a silently-dead backup is noticed.
- Missing R2/Supabase config is a `skipped` summary, not a throw.
