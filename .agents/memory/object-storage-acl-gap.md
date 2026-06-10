---
name: Object storage read ACL (CLOSED)
description: Photo bytes are now auth+ACL gated. Records how member-only photo privacy is enforced and the one residual provenance edge.
---

# Object storage read ACL — closed

`GET /api/storage/objects/*` (artifacts/api-server/src/routes/storage.ts) now requires auth (`requireAuth`) and runs a domain ACL before streaming bytes: `storage.canUserViewPhotoByUrl` allows a viewer only if they are the uploader, a member of a squad the photo was curated into (`sharedToSquad` + `squadId`), or host/member of the photo's event. Fail-closed: unknown object paths and non-matching viewers get 403. `/storage/public-objects/*` stays intentionally public.

**Why it matters:** the photo-vault surfaces render durable object paths. Previously the bytes route was unauthenticated, so the "members-only" promise was only enforced on metadata, not the files. It is now enforced on delivery too.

**Provenance:** the read ACL keys on `photos.url`. To stop a user forging a photo row for someone else's object path and self-authorizing, `photos.url` is **DB-unique** and `storage.addPhoto` is idempotent for the original uploader but throws `PhotoUrlConflictError` for anyone else. So each object path has exactly one authoritative owner row.

**Upload-URL issuance now auth-gated:** `POST /api/storage/uploads/request-url` now requires `requireAuth` (returns 401 unauthenticated). Anonymous callers can no longer mint presigned upload URLs. All mobile callers (vault, conversation, edit-profile) already send `authHeaders()` (Bearer), so this was a safe no-break add.

**Upload-time owner binding now exists (`object_uploads` table):** `POST /api/storage/uploads/request-url` records `(objectPath → ownerId)` at issuance (`storage.recordUpload`, objectPath is PK so first-and-only writer = the uploader the URL was handed to). Features that let a user attach a media path verify ownership via `storage.getUploadOwner(path) === userId` before trusting it. The **feed** enforces this (POST /feed/posts → 403 if the mediaUrl isn't owned by the author), which closes the IDOR where a forged post could self-authorize access to someone else's object via `canUserViewFeedMedia`. **Why:** the feed media ACL grants the post's author access to the bytes, so without owner binding a user could point a post at any known path. Photos still rely on their own `photos.url`-unique provenance; **moments do NOT yet verify `getUploadOwner`** — if moments add a forge-able media-claim path, gate it the same way.

**Client impact:** web `<img>` uses the same-origin session cookie (no change). Mobile expo-image must send `source.headers: authHeaders()` (Bearer) on protected `/objects/*` images. Avatars are external OIDC URLs, not `/objects/*`, so unaffected.
