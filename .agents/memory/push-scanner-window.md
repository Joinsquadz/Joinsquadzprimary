---
name: Push notification scanner window constraints
description: Day-of and reminder scanner time windows create invisible boundaries that vitest body-copy tests must respect.
---

The `runDayOfReminderScan` only fires for events where:

```
REMINDER_LEAD_MS (2h) < msUntil ≤ DAY_OF_LEAD_MS (14h)
```

**Boundary trap:** An event exactly 2h away satisfies `msUntil <= REMINDER_LEAD_MS` (the ≤ check), so the scanner marks it without sending. Tests using `+2h` expect a send but get nothing.

**Fix:** Use `+3h` (or any value clearly above 2h) for timezone-crossing tests that need the scanner to fire.

**"2+ calendar days" is geometrically unreachable within a 14h window.** With standard UTC offsets (max ±12h), you cannot have `calendarDaysUntil ≥ 2` while `msUntil ≤ 14h`. This code branch exists for theoretical completeness but is never exercised by the scanner.

**Why:** Body-copy tests for "today"/"tomorrow"/"2+ days" were initially written with real-world offsets (8h/26h/60h) that felt natural but violated the scanner's gate. Only the 8h test (today) worked; 26h and 60h are outside DAY_OF_LEAD_MS.

**How to apply:**
- Test `calendarDaysUntil ≥ 2` fallback via the `eventDate.test.ts` unit tests, NOT through `runDayOfReminderScan`.
- For "tomorrow" body-copy tests: use fake timers to put `now` at ~22:00 UTC and set the event 8h later (06:00 UTC next day, within window, daysUntil=1).
- For timezone cross-midnight tests: use `+3h` offset (safely above the 2h boundary), fake `now` to a time where the timezone puts the event on the same local calendar day.
