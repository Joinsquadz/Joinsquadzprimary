---
name: Reminder day labels need a real timezone
description: Why "today"/"tomorrow" push copy must never fall back to UTC, and how a missing event timezone silently corrupts it.
---

Relative day labels ("today" / "tomorrow") in notification copy must be derived
from a timezone the runtime actually recognises. When the source event has no
stored timezone, emit NO label and fall back to the event's own date text.

**Why:** UTC is not a neutral default for a calendar-day comparison. An event
stored without a timezone gets compared on the UTC calendar, and any evening
event in a behind-UTC zone has already rolled over to the next UTC day. A 9 PM
Pacific event produced a push reading "Coming up tomorrow — Sun, Aug 16 · 9:00 PM"
— the label contradicting the date printed beside it in the same sentence.
Pacific is UTC-7, so the corruption starts at 5 PM local and hits only evening
events, which is why it looks intermittent and unrelated to any user action.

The label is a property of the EVENT, not the recipient — it reads the event's
stored timezone, so it is identical for every recipient. Reports of "same user,
same phone, wrong label" are therefore never a per-account or device-timezone
issue; go straight to the event row.

**How to apply:** Use `relativeDayLabel(now, start, tz)` from `lib/eventDate.ts`
for any user-visible relative-day copy; it returns null for missing/invalid
zones. `calendarDaysUntil` still fails open to UTC by design and is fine for
pure day arithmetic — just never turn its result straight into copy. When
adding a new column that later feeds notification text, check for rows created
before the column existed: they read as NULL and quietly take the fallback
path. Prefer a fallback that cannot contradict itself over one that guesses.
