---
name: Vault favorites + lock scope
description: Where the 14-day free-tier vault lock applies vs not, and the favorites contract shape across vault surfaces.
---

The 14-day free-tier lock applies to the **personal vault** (`GET /vault/photos`) and the **Favorites** list (`GET /vault/favorites`). It does NOT apply to the **squad vault** (`GET /squads/:id/vault`) — that is a shared, always-viewable surface and only carries a per-caller `favorited` flag.

**Why:** the squad vault is a curated shared space; adding a lock there made the server return `{ locked:true, url:undefined }` for free users, but the mobile `SquadVaultPhoto` type/render path assumes `url:string` (no `locked` discriminator), so locked squad items rendered broken thumbnails. The plan also scoped squads.ts to the favorited flag only. There is a latent monetization-hole argument (a free user could view their own >14-day photos via a squad vault), but closing it is a deliberate product decision, not in scope here.

**How to apply:** if you ever add a lock/discriminated-union to the squad vault response, you MUST also convert mobile `SquadVaultPhoto` to a `locked:true|false` union and add a `LockedThumb` render branch + gate favorite/remove controls — mirroring the personal-vault grid. Otherwise leave squad vault unlocked.

Contract: personal `VaultPhoto` is a `locked:true|false` discriminated union (locked variant has no `url`); squad `SquadVaultPhoto` is flat with `url:string` + optional `favorited`. Both carry `squadId`/`squadName`. The mobile favorites set is reconciled via `syncFavorites(items)` after every fetch (personal, squad, favorites) by each item's `favorited` flag.
