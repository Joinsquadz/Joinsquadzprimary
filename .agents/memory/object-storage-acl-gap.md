---
name: Object storage read ACL (CLOSED)
description: Photo bytes are now auth+ACL gated. Records how member-only photo privacy is enforced and the one residual provenance edge.
---

# Object storage read ACL — closed

`GET /api/storage/objects/*` (artifacts/api-server/src/routes/storage.ts) now requires auth (`requireAuth`) and runs a domain ACL before streaming bytes: `storage.canUserViewPhotoByUrl` allows a viewer only if they are the uploader, a member of a squad the photo was curated into (`sharedToSquad` + `squadId`), or host/member of the photo's event. Fail-closed: unknown object paths and non-matching viewers get 403. `/storage/public-objects/*` stays intentionally public.

**Why it matters:** the photo-vault surfaces render durable object paths. Previously the bytes route was unauthenticated, so the "members-only" promise was only enforced on metadata, not the files. It is now enforced on delivery too.

**Provenance:** the read ACL keys on `photos.url`. To stop a user forging a photo row for someone else's object path and self-authorizing, `photos.url` is **DB-unique** and `storage.addPhoto` is idempotent for the original uploader but throws `PhotoUrlConflictError` for anyone else. So each object path has exactly one authoritative owner row.

**Residual edge (known limitation, flagged to user):** `POST /api/storage/uploads/request-url` is still unauthenticated and issues object paths with no upload-time owner binding. Paths are random UUIDs (effectively unguessable), so the only residual vector is a "first-poster-claims" race on a path an attacker already knows via a leak. True fix if ever needed: authenticate request-url and bind the issued objectPath to the requesting user (upload-intent token consumed on photo create), making provenance independent of who POSTs first.

**Client impact:** web `<img>` uses the same-origin session cookie (no change). Mobile expo-image must send `source.headers: authHeaders()` (Bearer) on protected `/objects/*` images. Avatars are external OIDC URLs, not `/objects/*`, so unaffected.
