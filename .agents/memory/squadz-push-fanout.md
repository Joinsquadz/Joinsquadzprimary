---
name: Squadz push notification fan-out
description: Invariants every feature push and the event reminder scheduler in api-server must satisfy.
---

# Squadz push notification fan-out

Every push that maps to a feature is sent fire-and-forget AFTER the response, in
try/catch. Each send must satisfy ALL of:

1. **Exclude the actor** (sender / host / sharer / joiner) from recipients.
2. **Gate on the matching user preference.** The Settings toggles
   (`notify_messages` / `notify_event_invites` / `notify_friend_activity` /
   `notify_reminders`) are enforced at the token-lookup layer. Forgetting the flag
   means the toggle silently does nothing — which is the whole feature.
3. **Respect per-squad mute** for squad-scoped sends: mute-filter BEFORE token
   lookup. Standalone (non-squad) events skip the mute filter.

**Why:** the feature's entire point is that toggles actually work; a missing pref
flag or mute filter is a functional bug, not a cosmetic one.

## Reminder scheduler fire-once rule
A "starting soon" reminder must be marked sent **only after a successful send**,
never before.

**Why:** marking before the send (or before recipients exist) loses reminders on
transient push-provider failures and skips users who RSVP "going" later in the
lead window — a code review caught exactly this.

**How to apply:**
- No recipients yet → leave unmarked (late RSVPs must still be reminded).
- Send failed → leave unmarked (retried next scan).
- Event start already past → mark sent without sending (stops endless rescans).
- Event date is free-form text, parsed best-effort; unparseable/TBD → skip, leave
  unmarked.

## RSVP has two entry points
A member can RSVP via the RSVP endpoint OR by joining with an invite code — both
write `rsvps[user]="going"`. Any host-notification (or other RSVP side-effect)
must be wired on BOTH paths, or invite-code joins silently skip it. A review
caught the join path missing the host push.

## Deep-link target nuance
Photo-share notifications deep-link to the squad **vault**, not squad home — the
vault is its own screen keyed by squadId. Picking the squad-home screen for a
vault event is a deep-link bug.

## Migration tooling gotcha
`drizzle-kit generate` chokes on an **absolute** `out` path (builds a malformed
doubled path). Keep the drizzle config `out` **relative**; the db scripts always
run with cwd = the db package.
