---
name: Squadz push notification fan-out
description: Invariants for every server-side push send and the event reminder scheduler in api-server.
---

# Squadz push notification fan-out

Every push that maps to a feature is sent fire-and-forget AFTER `res.json`, wrapped
in try/catch + `logger.error`. Each send must satisfy ALL of:

1. **Exclude the actor** (sender / host / sharer / joiner) from recipients.
2. **Gate on the user preference** via `getPushTokensForUsers(ids, { requireNotify... })`
   — the toggle names are `notify_messages` / `notify_event_invites` /
   `notify_friend_activity` / `notify_reminders`. Skipping the flag means the Settings
   toggle silently does nothing (the whole point of the feature).
3. **Respect per-squad mute** for squad-scoped sends: call
   `storage.filterUnmutedForSquad(ids, squadId)` BEFORE token lookup. Standalone
   (non-squad, `squadId === ""`) events skip the mute filter.

Pref mapping used: chat→messages; event invite + best-time-locked→event_invites;
RSVP-to-host + friend-add + vault-share→friend_activity; "starting soon"→reminders.

## Reminder scheduler (index.ts) fire-once invariant
**Why:** marking an event sent BEFORE the send (or before recipients exist) loses
reminders on transient Expo failures and skips users who RSVP "going" later in the
window — a code review caught exactly this.

**How to apply:**
- Mark `reminderSentAt` ONLY after `sendPushNotifications` resolves successfully.
- Do NOT mark when there are zero "going" RSVPs yet (later RSVPs in the 2h lead
  window must still be reminded).
- DO mark immediately when the parsed start is in the past, so the scan stops
  reprocessing it. Unparseable dates are left unmarked (low volume, retried).
- Event `date` is free-form text; parse best-effort via `lib/eventDate.ts`
  `parseEventStart()` (returns null for TBD/unparseable).
