---
name: Squad conversation membership enforcement
description: Squad participant rows are append-only; every access/eligibility check must re-verify CURRENT squad membership, not trust participant rows.
---

Squad-type conversations lazily add a `conversation_participants` row per member, but these rows are **never pruned** when someone leaves a squad. So a stale participant row outlives membership.

**Rule:** Any code that gates access to, lists, or counts a *squad* conversation must re-check current squad membership (`squads.memberIds @> [userId]`), NOT rely on the participant row alone. Direct (DM) conversations are still governed by the participant row.

**Why:** Trusting the stale row leaked private data to removed members — message-attachment bytes via the object proxy, plus conversation previews/sender metadata/unread counts via the list and unread-count endpoints. Found and fixed during code review of the messaging feature.

**How to apply:** In `api-server/src/storage.ts`:
- `getConversationForMember` already does the right thing (squad → `isSquadMember`); reuse it as the single source of truth where possible.
- `canUserViewMessageAttachment` delegates to `getConversationForMember` (don't gate on `isConversationParticipant`).
- `listConversationsForUser` filters squad rows to current-squad ids; `getTotalUnreadCount` skips squad rows whose `squadId` isn't a current squad.
- If you add a new squad-conversation read path, apply the same current-membership gate. Better long-term fix would be to prune participant rows on squad removal, but until then every path must be membership-aware.
