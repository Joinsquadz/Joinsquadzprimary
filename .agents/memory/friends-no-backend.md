---
name: Friends feature has no backend
description: The mobile "friends" list is client-only in-memory state; there is no friends table or list endpoint.
---

The Squadz mobile "friends" feature is NOT persisted anywhere on the server.

- There is **no** `/api/users/friends` endpoint. `users.ts` only exposes `by-friend-code/:code`, `/api/users`, `/api/users/search`.
- The `friends: string[]` in `AppContext` is plain React state. `addFriend`/`removeFriend` mutate local state only; the list resets on app restart.
- Adding a friend DOES resolve a real user id (via `GET /api/users/by-friend-code/:code`), so the ids are real — they just aren't saved server-side.

**Why:** A "make friends live" request looks like simple wiring but is actually a whole feature build (DB table + CRUD endpoints + wiring across ~9 screens). Don't assume the list is durable.

**How to apply:** To make friends production-grade you must build the backend (e.g. a `friendships` table + list/add/remove endpoints), then have AppContext fetch/persist instead of using in-memory state. Until then, never seed fake friend ids — keep the initial list empty so new users see a true "no friends yet" state.
