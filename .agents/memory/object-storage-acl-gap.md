---
name: Object storage ACL gap
description: Photo bytes are served without auth/ACL, so any "members only" / private vault promise is only enforced on metadata, not the files.
---

# Object storage has no read ACL

`GET /api/storage/objects/*` (artifacts/api-server/src/routes/storage.ts) streams object bytes to ANYONE with the path — there is no `requireAuth` and no ACL check on read. The handler comment even says ACL is optional/not wired.

**Why it matters:** every photo-vault surface (personal vault, event vault, squad vault) returns durable raw object paths and renders them via `/api/storage${url}`. So the "private, members-only" promise is enforced only on the *metadata* endpoints (which do check membership/Pro) — the actual image files are guessable/shareable URLs with no membership check. This is pre-existing and platform-wide, not specific to any one feature.

**How to apply:** if a task requires real per-user/per-squad media privacy, you must add authz on object delivery (gate `/storage/objects/*` behind auth + an ACL that checks the requester against the photo's owner/squad membership) OR switch to short-lived signed read URLs scoped to an authorized viewer. Don't claim a vault is "private/members-only" until this is closed.
