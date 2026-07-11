---
name: Squad photo roll-up
description: How curated per-squad photo vaults work (data model + access rules) and why it's modeled this way.
---

# Squad photo roll-up (curated squad vault)

Members hand-pick their OWN uploaded photos to share into a per-squad vault (curated "best of", not a free-for-all upload). Uploader name + timestamp are shown as attribution.

## Data model
`photosTable` carries the share state directly: `squadId` (text, nullable) + `sharedToSquad` (boolean, default false). A photo is "in" a squad vault when `squadId = :id AND sharedToSquad = true`. The squad is set at share time (from the squad the user is rolling up into), NOT derived live from the event each read.

**Why:** keeps the squad-vault list query a simple indexed filter and decouples vault membership from the event→squad relationship (a photo may have no event). Tradeoff: photos still cascade-delete with their event (existing FK), so an event deletion still removes rolled-up copies.

## Access rules (enforced in routes/squads.ts + storage.ts)
- `GET/POST/DELETE /squads/:id/vault` all require auth + squad membership (`getSquadIfMember` → `memberIds.includes(userId)`).
- Sharing only affects the caller's OWN photos: `setPhotosSharedToSquad` filters by `uploaderId`; non-owned ids are silently ignored.
- Unshare requires `photoId + uploaderId + squadId` to all match — you can't remove someone else's share.
- Squad vault VIEW is intentionally NOT Pro-gated (members see shared memories); the roll-up picker pulls from `GET /vault/photos`, which IS Pro-gated, so only Pro users have a personal vault to roll up from.

## Two squad-photo surfaces must stay reconciled
There are TWO reads of "photos belonging to a squad" and they must agree:
- `getSquadVaultPhotos` (→ `GET /squads/:id/vault`, the curated roll-up the vault SCREEN renders): filters `squadId = X AND sharedToSquad = true` — includes event-less shared photos.
- `getPhotosBySquadId` (→ `GET /vault/photos?squadId=`): now a lossless SUPERSET = event roll-ups (`eventId IN squadEvents`) OR the sharedToSquad set. It historically returned ONLY event roll-ups, silently dropping event-less "shared straight to squad" photos.

**Why:** any screen that switches to / falls back on `/vault/photos?squadId=` would make event-less squad photos vanish. Keep `getPhotosBySquadId` ⊇ `getSquadVaultPhotos`. Regression guarded by the real-DB test `__tests__/concurrency/vault.squadPhotos.realDb.test.ts` (runs via `test:concurrency`, NOT the default unit suite — so the default validation run won't catch a re-narrowing).

## Caveat
These photo endpoints bypass the OpenAPI/codegen contract — they're plain Express routes validated with inline zod, and clients call them with raw `fetch`. Match that pattern for related photo endpoints rather than adding them to the OpenAPI spec.
