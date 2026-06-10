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
**Watch:** a one-off `StorageApiError: new row violates row-level security policy` on
`createSignedUploadUrl` was seen in-server but was NOT reproducible with the same
service-role client — treat as a transient Supabase hiccup, not the root cause.
