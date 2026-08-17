---
name: Native Intl time formatting
description: Guard against native Intl omitting clock fields in combined date/time part formatters.
---

For user-facing event labels, format the calendar date and clock time with separate `Intl.DateTimeFormat` calls, and reject incomplete output rather than rendering a partial label.

**Why:** A native runtime can omit requested time parts from a combined `formatToParts` result, which leaves an event reading like a date plus `: · PDT` instead of its actual clock time.

**How to apply:** Any shared formatter that displays a date, time, and zone abbreviation should validate its components or use separate date and time formatters. Keep the stored date text as the fallback for all-day, TBD, and legacy records.