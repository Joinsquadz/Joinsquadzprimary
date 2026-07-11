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

# Personal-vault fetch sharing (deliberate asymmetry)
- The `/api/vault/photos` fetch is shared via `hooks/useVaultPhotos.ts` for the simple consumers (Photos tab, EventVaultPanel).
- **`app/vault.tsx` deliberately keeps its own fetch.** **Why:** its personal path also drives favorites sync + a separate subscription check + scoped params the generic hook doesn't model; routing it through the hook risks the favorites/isPro sequencing. **How to apply:** don't "dedupe" vault.tsx into the hook without also carrying favorites + subscription concerns.
- Squad vault has two view modes (flat Grid + grouped By Events). **Gotcha:** when a grouped list packs each group's photos into a single row, key the row off a photo id, not the row index (every group's row index is 0 → duplicate-key churn).
