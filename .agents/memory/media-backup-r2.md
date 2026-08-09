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

## The backup run's lock transaction is discarded — don't write durable state in it

The advisory lock is held in a transaction that is always rolled back, so a
durable row written inside it (e.g. the last-successful-run marker) vanishes,
and a healthy backup then looks like it never succeeded.

**How to apply:** commit such writes explicitly, or keep them outside the lock
transaction.

## A restore drill must fail closed on both content and cleanup

**Why:** a drill can claim success while being worthless — bytes served under
the wrong media type still break playback, and an abandoned scratch bucket is
an unmanaged copy of production media.

**How to apply:** verify by round-trip (read the object back OUT of the
destination; compare bytes, SHA-256 and media type, ignoring case and
parameters) — never trust that the upload call returned OK. Treat cleanup as
part of the contract: propagate delete errors, re-confirm the destination is
gone, prove absence ONLY from an explicit 404 status (never from error text,
which turns an auth/network failure into a false "it's gone"), and exit
non-zero for unverified content OR unconfirmed cleanup. Refuse any destination
that is not throwaway: never a configured live bucket, always a required
scratch prefix, never a pre-existing bucket.

## Supabase Storage reports a missing bucket as status 400 + statusCode "404"

`getBucket()` on an absent bucket returns a `StorageApiError` whose numeric
`status` is **400** while the string `statusCode` is **"404"**.

**Why:** code that checks only the numeric `status === 404` concludes the
bucket exists (or that the error is fatal) and refuses to proceed.

**How to apply:** parse BOTH fields numerically and accept a 404 from either.

## Design invariants worth keeping

- Incremental: skip when a key of the same size already exists in R2 (HEAD, and
  treat a 404 as "not backed up"). A second run must copy 0.
- Exactly one instance copies per night: `pg_try_advisory_xact_lock` on a
  dedicated pooled connection, held for the run, rolled back at the end. A lost
  lock is a skip, not an error.
- Per-object failures are counted and logged but never abort the run; a run with
  failures raises a Sentry warning so a silently-dead backup is noticed.
- Missing R2/Supabase config is a `skipped` summary, not a throw.
