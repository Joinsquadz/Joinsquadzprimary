---
name: Squadz age gate, friends-only DMs, mutual blocking
description: Product invariants for the 13+ signup gate, the friends-only DM rule, and what blocking must sever — plus the boundaries that must NOT be crossed.
---

## 13+ age gate

Registration requires a date of birth and the **server** is the gate; the mobile
picker is UX only. Persist ONLY the derived marker + birth year — never the exact
date of birth.

**Why:** minimum-age compliance has to survive a direct API call, and keeping the
exact DOB is unnecessary personal data once the decision is made.

**How to apply:** any new signup path (new provider, invite-accept shortcut, admin
create) must run the same derivation before an account exists anywhere — including
before an external auth subject is provisioned, or an under-13 subject is orphaned.
Login-time profile syncs must not overwrite the stored age fields with nulls.

Existing accounts were deliberately **not** backfilled — they carry a null marker
rather than a guessed one. Don't "fix" that with a default; it fabricates
compliance data.

## Friends-only DMs

A private conversation requires a **current friendship**, checked on create, on
list, on read, and on send. Sharing a squad grants group chat only — it never
grants a DM, and it never implies friendship.

**Why:** the old rule authorized DMs from shared-squad history, so anyone who had
ever been in a squad with you could message you forever.

**How to apply:** unfriending or blocking must close existing threads too, not just
block new ones. Denial copy stays neutral and identical in both directions.

## Blocking is mutual and severs the private relationship

Blocking must, in one operation: write the block, delete BOTH symmetric friendship
rows, and decline pending friend requests in BOTH directions.

Blocking deliberately does **not** touch shared squad group chat — both people keep
seeing squad messages; the remedy is leaving the squad. Don't "fix" this either;
hiding messages inside a group chat confuses everyone else in it.

**How to apply:** because a blocked user's profile is unreachable, the block list
endpoint must return display data (name + photo) inline — a Settings screen cannot
fan out per-profile fetches that are themselves block-gated. Settings → Blocked
Users is the only unblock path, so a silent failure there traps the user.

## A block must remove the person from DISCOVERY, not just from their profile

Every surface that can *find* a user has to filter both block directions: name
search, friend-code lookup, the friends list, and the discover feed (which works
off the friend set, so filtering that set covers its squad AND event queries).

**Why:** an early pass gated only the profile route. A blocked user still appeared
in search and still resolved by friend code, complete with an add affordance —
tapping through 403'd, so the UI dead-ended, and the row itself confirmed the
account exists. That is precisely what a block is meant to deny.

**How to apply:** exclude in the QUERY, never by post-filtering a page of results,
or blocked matches silently eat result slots. Denial copy stays neutral (a blocked
friend code returns the same "no user found" as a bad one) — never disclose that a
block is the reason. The both-directions lookup lives in `lib/blocks` rather than
the moderation router precisely so discovery routes can import it without pulling
in that router's dependency graph.

**The deliberate exception:** bulk user hydration is NOT block-filtered. Blocking
leaves shared squad group chat intact, so filtering there would blank out names for
everyone in the squad. Adding a filter there is a regression, not a hardening.

## Hidden content must be unreachable by id, not just absent from lists

Auto-hide (3+ distinct reporters) sets `status = "hidden"`. Filtering that in the
list query is only half the job — per-id paths (react, comment, read comments,
mark viewed) load the row directly.

**Why:** anyone holding an id from a screenshot, a push notification, or their own
earlier scroll could keep interacting with reported content, and each reaction kept
generating fresh activity rows and push notifications for the author.

**How to apply:** put the check inside the shared audience helper (`canViewPost` /
`canViewMoment`) so every per-id path inherits it at once, and keep the author
allowed through — they must still see and delete their own hidden post. Any new
list surface needs the `ne(status, "hidden")` predicate too; the squad moments list
shipped without one.

**Blocks belong in the same helper, and filtering the LIST is not enough.** Squad-
audience posts/moments are authorized by membership, and blocking deliberately
leaves shared squads intact — so a blocked user holding an id could still mark a
moment viewed or react to it, pushing a notification straight to the person who
blocked them. The block check has to sit beside the hidden check in the audience
helper, not only in the list query. Also make sure per-id reads reject soft-deleted
rows (`deletedAt`) for the author too, not just for other viewers.

## A shared squad is not a DM key, and membership is not consent

A private thread is open only while the two people are currently friends and neither
has blocked the other. Conversation participant rows are append-only, so "is a
participant" keeps returning true after an unfriend or block and can never be the
authorization for a DM.

**Why:** the first pass gated only thread creation, listing, reading and sending,
which left a former friend with a live event stream, the ability to write read
state, and — worst — continued access to the stored bytes of old DM attachments.

**How to apply:** every DM surface goes through one live gate, including long-lived
connections, which must be re-checked before each push rather than only at connect
time (even a bare "something happened" ping is activity disclosure) and fail closed
when the check errors. Squad and event chats stay membership-based and skip it. One
deliberate exception: reporting a message stays membership-based, or the "send abuse
then block" pattern would also close the victim's report path.
