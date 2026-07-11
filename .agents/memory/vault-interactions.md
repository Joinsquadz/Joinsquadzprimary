---
name: Vault media interactions
description: Access model + interaction rules for the photo vault (captions/hearts/comments/share-to-Vibe).
---

# Vault access model
- Squad vault: FREE for all squad members, always — no time-locks, no expiry, no paywall. The old 14-day/30-day rule was removed entirely (list endpoints, read-time storage object lock, event-photo endpoint, mobile copy).
- Personal roll-up (`GET /vault/photos` with no squadId/eventId scope) and Favorites (`GET /vault/favorites`): **Squadz+ only**, gated by ONE entrance gate. Non-Pro gets `{ photos: [], isPro:false, requiresPro:true }` — no per-item locks.
- Squad/event-scoped vault reads stay open to members regardless of Pro.

# Interaction authz (all routes)
- Hearts/comments/share verify **view access** via `canUserViewPhotoById` — NOT feed owner check.
- Caption PATCH is uploader-only (300 char cap).
- Comment soft-delete: comment author OR photo uploader.
- Share-to-Vibe: creates a **friends-audience** feed post (audience hard-locked server-side) referencing the same media; bypasses the feed owner check because vault view-access already authorized it. Original vault row is never mutated.
- Push fan-out: exclude the actor, gate on recipient notify pref (`requireNotifyFriendActivity`).

# Heart toggle must be atomic
**Rule:** `storage.toggleHeart` must flip via DELETE … RETURNING first, then INSERT … onConflictDoNothing when nothing was deleted. Never read-then-write (`select existing` → branch).
**Why:** two concurrent toggles can both read "not hearted" and net to the wrong state; the unique(photoId,userId) constraint + delete-returning makes each call self-consistent.
**How to apply:** any new per-user toggle (heart/like/save) follows this pattern; also guard the client button with an in-flight ref so double-taps can't race.

# SSE
- Native vault stream hook uses `import { fetch } from "expo/fetch"` (RN built-in fetch has null response.body) and reconnects on AppState "active", with a 20s poll fallback.

# Shared personal-vault fetch hook (useVaultPhotos)
- `hooks/useVaultPhotos.ts` is the shared `/api/vault/photos` fetcher (auth headers + isPro/requiresPro/loading). Used by `(tabs)/photos.tsx` and `components/EventVaultPanel.tsx`.
- **`app/vault.tsx` is intentionally NOT migrated to it.** Its personal path adds `syncFavorites`, a separate `/api/subscription` check (`checkSubscription`), scoped query params, and its own `photosLoading`. Forcing it through the generic hook breaks the intricate favorites/isPro sequencing.
- **Squad vault "By Events" view**: SectionList grouped by `p.eventId` via `eventsById` lookup (title/emoji, fallback 🎉/"Event"); null eventId → "All other photos" (📷); each section carries one data row = the photo array, rendered as a flex-wrap grid reusing `renderSquadCell`. Section keyExtractor must key off `group[0].id`, not the row index (all rows are index 0).
