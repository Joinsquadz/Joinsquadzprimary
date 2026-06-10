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
