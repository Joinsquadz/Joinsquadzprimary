---
name: Account deletion media byte cleanup
description: How a deleted account's storage bytes are identified and removed without ever touching another user's media.
---

Deleting an account must remove the BYTES in three places: the private Supabase
bucket, the public avatar bucket, and the R2 nightly backup mirror. The DB purge
alone leaves all of them behind.

**Rule 1 — ownership comes from provenance, never a path prefix.**
Private objects are resolved only from `object_uploads` rows matching the owner,
and only at the exact recorded path.

**Why:** every user's uploads land in one flat `uploads/<uuid>.<ext>` namespace,
so any prefix-based sweep deletes other people's media. There is no per-user
folder to scope to.

**Rule 2 — the avatar is deleted only if the stored URL validates as app-owned**
(configured Supabase host AND the configured public avatar bucket).

**Why:** the same profile-image column also holds Google/Apple/CDN provider
URLs. A permissive parse would attempt to delete something the app does not own.

**Rule 3 — collect targets BEFORE the purge transaction.**

**Why:** the purge deletes the `object_uploads` rows that prove ownership. After
commit there is no safe way to tell the account's objects apart from anyone
else's.

**Rule 4 — bytes are deleted AFTER commit and cleanup never throws.**
Failures go to a durable retry queue (unique per object, backoff, hard attempt
cap that escalates to Sentry) rather than failing the request.

**Why:** the user's deletion must not be blocked or rolled back by a storage
outage, but a silent leak of their media is equally unacceptable.

**How to apply:** any new media-bearing feature must record upload provenance
for its objects, or its bytes will survive account deletion. R2 backup keys are
derived as `supabase/<bucket>/<object-key>` and must stay in lockstep with the
backup writer's key derivation — if one changes, the other orphans backups.
