---
name: Viewer-local event times
description: Why Squadz event times are stored as instants and converted only at render/notify, and the traps that keep reappearing.
---

# Viewer-local event times

Event times are stored **absolute**. Timezone conversion happens only at display
time or when composing a notification — never on write.

**Why:** an event also carries a creator-authored wall-clock display string. It
is the creator's clock, so for anyone else it is the wrong time and often the
wrong *calendar day* (6:00 PM Wednesday in Los Angeles is 10:00 AM Thursday in
Tokyo). Treating that string as a time value is the recurring bug in this area.

## How to apply

- **Two distinct concerns, two different sources.** Rendering a label converts
  the instant into the viewer's chosen zone. Doing *time math* — countdowns,
  past-vs-upcoming, reminder scheduling — resolves the instant first and only
  falls back to parsing the display text for legacy events that have no
  instant. Parsing that text yields a **device-local** moment, so a viewer in
  another zone gets a countdown that is hours off, an RSVP nudge on the wrong
  day, and plans filed under the wrong tab. Both concerns have a single shared
  helper; new surfaces call them rather than re-deriving a date.
- **Fallback ladder:** all-day / TBD / legacy events keep the stored text
  verbatim — it is the only accurate thing available. An `Intl` failure falls
  back to it too, rather than rendering an empty label.
- **Manual beats automatic.** Detection may update a saved zone; a *manual*
  selection must never be overwritten by it, or a deliberate choice silently
  reverts and every time the user reads shifts. Validate zone names
  server-side — an unrecognised zone degrades every future date to fallback
  text with no error.
- **Never hardcode zone abbreviations.** Derive PDT/PST/EDT/EST from `Intl` at
  the given instant; a static map goes stale twice a year.
- **Push:** timing stays on absolute instants; only the copy is personalized.
  Group recipients by saved zone, one send per group. No recipient zone →
  inherit the event's; neither → drop the day label entirely, because
  "today"/"tomorrow" computed in UTC misdates behind-UTC evening events.
- **Any endpoint that feeds a time to a client must expose the absolute
  instant**, not just display text — otherwise the client physically cannot
  localize it. Read-only invite/preview endpoints are the easy ones to miss.
