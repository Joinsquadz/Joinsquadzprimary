---
name: Account deletion tombstones
description: Deleted credentials must never re-provision an account — tombstone by auth subject id, checked in the login sync path.
---

**Rule:** DELETE /account must (1) purge app data, (2) write `deleted_account_tombstones` rows (subject_id PK, raw SQL table like webhook_email_sends, ensured at startup) INSIDE the purge tx, (3) best-effort delete the Supabase auth subject(s), (4) revoke the caller's bearer. The login/signup sync path (`syncSupabaseUser`) checks `isAnyTombstoned([subject.id, app_metadata.linkedUserId])` and throws `AccountDeletedError` → handlers return a generic 401/409.

**Why:** The users-table upsert at login silently resurrects "deleted" accounts: purging app data alone leaves the Supabase auth user alive, so the same password logs in and re-creates an empty row with the same UUID (found live in E2E — deletion "didn't stick"). Linked identities (`app_metadata.linkedUserId`) sign in with a DIFFERENT subject id than the canonical user id, so deleting only `deleteUser(userId)` misses them.

**How to apply:** Tombstone by SUBJECT id, never email — a fresh signup with the same email gets a new subject id and must work. Any new auth entry point that inserts/updates a users row from external identity claims must add the tombstone check. External auth deletion failures are logged, not fatal — the tombstone is the durable backstop.
