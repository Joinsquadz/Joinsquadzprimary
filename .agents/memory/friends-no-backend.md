---
name: Friends feature IS server-backed
description: The mobile "friends" list is persisted server-side via /api/users/friends (GET/POST/DELETE). Prior "no backend" note was outdated.
---

The Squadz mobile "friends" feature **is** persisted on the server (this corrects an earlier note that said it was client-only).

- `GET /api/users/friends`, `POST /api/users/friends`, `DELETE /api/users/friends/:id` exist.
- `AppContext` holds `friends: string[]` plus `addFriend`/`removeFriend`/`fetchFriends`. `fetchFriends` is the single source of truth and runs on auth; `addFriend`/`removeFriend` call the API and reconcile via `fetchFriends` on failure.
- Derive "is this person a friend?" from `friends.includes(userId)` — there is no `isFriend` helper.

**Why:** A past session wrongly assumed friends were in-memory; the backend was added later. Don't reintroduce fake seed ids or rebuild the backend.

**How to apply:** Add-friend UI (e.g. `components/ContactSheet.tsx`) just calls `addFriend(id)`/`removeFriend(id)` and reads `friends`. Hide the toggle for self (`id === currentUser.id`).
