---
name: SecureStore + EXIF strip + Report/Block system
description: Security fixes — auth token encryption, EXIF strip, report/block moderation
---

## SecureStore token migration pattern (AppContext.tsx)

Auth tokens are stored in expo-secure-store, NOT AsyncStorage. Three module-level helpers
handle the full lifecycle:
- `getSecureToken(key)`: reads SecureStore; on miss, checks AsyncStorage and migrates atomically (one-time upgrade for existing users); falls back to AsyncStorage if SecureStore unavailable
- `setSecureToken(key, value)`: writes SecureStore; also removes any legacy AsyncStorage copy
- `removeSecureToken(key)`: deletes from both stores

AUTH_TOKEN_KEY and REFRESH_TOKEN_KEY are NOT in ALL_APP_STORAGE_KEYS (multiRemove won't clear them).
Logout/deleteAccount/clearLocalSession call explicit removeSecureToken for both.

**Why:** AsyncStorage is plain-text on Android; tokens in SecureStore are AES-256 encrypted by the OS keystore.

## EXIF strip pattern (lib/imageUtils.ts)

`stripImageExif(uri, mimeType)` returns `{ uri, mimeType }`. For photos: re-encodes via expo-image-manipulator → JPEG (strips all metadata incl GPS); videos pass through unchanged. On any error, returns original values (never blocks upload).

Call site pattern: `const { uri: uploadUri, mimeType: uploadMimeType } = !isVideo ? await stripImageExif(asset.uri, contentType) : { uri: asset.uri, mimeType: contentType };`

Applied at: feed.tsx handlePost, vault.tsx uploadAsset, moment/compose.tsx, conversation/[id].tsx uploadAsset.

**Why:** GPS EXIF in uploaded photos leaks location. Re-encoding drops all metadata fields.

## Report/Block moderation

Server (`moderation.ts`):
- POST /api/reports: stores in reportsTable (idempotent via onConflictDoNothing)
- POST/DELETE/GET /api/users/:id/block, GET /api/users/blocks
- getBlockedAndBlockerIds(userId): two separate Drizzle queries (blockerId→blockedId + blockedId→blockerId); avoids or() type issues in Drizzle 0.45.x where req.params.id is string|string[] → must parseId() before passing to eq()

Feed/moments: block filter applied in GET /api/feed, GET /api/moments/friends, GET /api/moments/feed.

Mobile (feed.tsx): ellipsis button on ALL posts (not just canDelete); handlePostMenu branches on post.canDelete.

**Why:** Drizzle 0.45.x req.params.id types as string|string[] in Express — always parseId() before eq().
