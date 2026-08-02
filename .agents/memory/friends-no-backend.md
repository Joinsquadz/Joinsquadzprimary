---
name: Friends are request/accept, server-backed
description: How the friends model actually works — request/accept flow, not instant-mutual; which routes the client really uses.
---

Friends use a **request/accept model by design**, fully server-backed.

- Client `addFriend` (AppContext) POSTs `/api/users/friend-requests`; the recipient accepts from the Activity screen. "Request sent!" toasts are correct behavior, not a stub.
- An older instant-mutual `POST /api/users/friends` route still exists server-side but the client does NOT use it. Don't "fix" the client to call it.
- `friends[]` + `fetchFriends` live in AppContext; derive `isFriend` via `friends.includes(id)`.

**Why:** an earlier memory wrongly claimed friends had no backend / were instant-mutual; that led to re-flagging correct request/accept UX as a bug during E2E testing.
**How to apply:** when testing or changing friend flows, expect request → accept via Activity; never treat "Request sent!" as a failure.
