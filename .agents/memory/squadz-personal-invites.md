---
name: Squadz personal invites
description: How direct friend-invites to trips/events work (events.invitedUserIds) and the UI/backend authz parity rule.
---

Direct friend invites to a trip/event are stored in `events.invitedUserIds` (jsonb text[]).

**Rule:** `invitedUserIds` grants access IN ADDITION to squad membership (trips) / rsvps (events). It is ONLY written by explicit invite/uninvite — never by RSVP — so it is immune to the stale-RSVP trap (a removed squad member's leftover RSVP must not grant access; an explicit invite is a separate, deliberate grant).

**Why:** trips re-check live squad membership and ignore rsvps; events use rsvps. Neither alone lets you invite a non-member friend. invitedUserIds is the orthogonal, durable grant.

**How to apply:**
- Access (`userCanAccessEvent`): host → ok; in invitedUserIds → ok; trip → live squad member; event → in rsvps.
- List visibility surfaces rows where `invitedUserIds ? userId` (jsonb contains).
- Invite authz (`POST /events/:id/invite`): inviter must already have access (`getEventAsMember`); each target must be friend-of-inviter (`storage.getFriendIds`) OR current squad member (`filterInvitableTargets`) — never an arbitrary id. Atomic jsonb dedupe-append, version bumped, no version gate needed.
- Uninvite (`DELETE /events/:id/invite/:userId`): host (anyone) or self (leave) only.
- **UI invite affordance must mirror "has access", not a narrower host-only/RSVP-only shortcut**, or authorized users can't invite from the UI while the backend allows it (the exact drift architect caught). Event canInvite = host || in rsvps || invited; Trip canInvite = host || squad member || invited.
- Mobile: one reusable `components/FriendPickerSheet.tsx` (default export, multi-select, excludeIds) is shared across create.tsx + event/[id].tsx + trip/[id].tsx.
