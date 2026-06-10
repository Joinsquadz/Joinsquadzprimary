---
name: Profile identity fallback & upload URL resolution
description: Two recurring mobile gotchas — mock ME leaking a fake identity, and public-vs-protected upload URL construction.
---

# Mock `ME` fallback must be neutral, never a fake person

`currentUser` in `context/AppContext.tsx` falls back to the `ME` constant
(`data/mock.ts`) whenever `apiUser` is momentarily null — the load window before
`/auth/me` resolves, and on token-refresh failure. If `ME` is a realistic person
(it was "Jordan Park"/"JP"), the UI briefly impersonates a stranger as the signed-in
user. Keep `ME` neutral (`name: "You"`, empty initials).

**Why:** users reported "my name randomly shows Jordan Park." It was the fallback,
not corrupted data.
**How to apply:** never give mock/default identity constants real-looking names;
any default-context or fallback identity must read as a placeholder. The transient
null-`apiUser` window still exists, so the fallback is user-visible.

# Public vs protected upload URL resolution

`POST /storage/uploads/request-url` returns `objectPath` in two shapes depending on
`isPublicAccess`:
- public (e.g. profile avatars) → a FULL Supabase public `https://...` URL, use verbatim.
- protected → a relative `/objects/...` path served through the auth-gated `/api/storage` proxy.

Blindly prepending `/api/storage` to a full URL makes a broken link; `<Image>` then
silently falls back to initials, looking like "the upload didn't save."

**Why:** uploaded profile pictures never displayed — purely client URL construction.
**How to apply:** use `resolveUploadedUrl()` in `lib/api.ts` (branches on `^https?://`)
for any uploaded-path → URL conversion; unit-tested in `lib/__tests__/api.test.ts`.
Avatars are shown via plain `<Image>` (no auth headers), so they MUST be public URLs.

# Avatars must come from a PUBLIC bucket; two-bucket split is by design

Rule: serve avatars (anything loaded by a no-auth `<Image>`) from a bucket whose
`public` flag is true; keep all private media (vault/attachments/feed) in a separate
PRIVATE bucket behind the auth-gated signed-URL redirect. Never make the private
bucket public, and never serve avatars from it.

**Why:** a private Supabase bucket's `getPublicUrl()` returns a link that 400s, so an
avatar uploads fine (PUT 200, signed download 200) but never displays — it looks
exactly like "the upload didn't save," but the bytes are there. The split is the
containment boundary (private media stays auth-gated, only avatars are public).

**How to apply:**
- Two buckets: private (`SUPABASE_STORAGE_BUCKET`) + public (`SUPABASE_PUBLIC_BUCKET`,
  default `squadz-avatars`). Branch on the `isPublicAccess` upload flag.
- Fail closed, never fall back: a public-upload request must not degrade to the
  private/auth-gated path on error (that re-creates the broken-avatar bug). Verify the
  public bucket is actually `public===true` before trusting it, don't just assume it
  exists.
# Storage RLS denial = a user session contaminated the shared supabase client

Symptom: `StorageApiError: new row violates row-level security policy` (403) on
`createBucket` / `createSignedUploadUrl` IN-SERVER, while the identical service_role
client works in a standalone script. The startup key check confirms `role:
"service_role"`, so the key is fine — the request just isn't being sent as
service_role.

**Why:** supabase-js keeps a signed-in user's session IN MEMORY on the client even
with `persistSession:false`. The Storage sub-client resolves its `Authorization`
header from that session, so after ANY session-setting auth call
(`signInWithPassword`, `refreshSession`, `setSession`) on a client, every later
`.storage.*` call on the SAME client sends the user's JWT instead of the service key
→ RLS denial. It's intermittent: storage works until a user logs in on the server,
then breaks. `admin.createUser` and `getUser(token)` are non-mutating and safe.

**How to apply:** keep TWO separate client instances (`services/supabase.ts`):
`supabaseAdmin` (Storage + admin.*, must stay pristine) and `supabaseAuth` (the
session-setting flows in `routes/auth.ts`). Never call signInWithPassword/
refreshSession/setSession on the admin/storage client. Repro/verify: sign a user in
on a shared client, then a `.storage` write flips OK→RLS; on separate clients it
stays OK.
