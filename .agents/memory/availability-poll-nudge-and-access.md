---
name: Availability poll nudge eligibility & scoped access
description: Server rules the poll UI must mirror — nudge only for members with no response row, and scoped polls authorize by CURRENT squad/event membership, not by who created them.
---

## Nudge is only valid for members with NO response row

The nudge endpoint rejects a target who already has a response row. After an
organizer edits a poll's date range, trimmed members still count as having
responded (the trim deliberately preserves each response's `updatedAt`), so they
are **not** nudgeable even though the UI wants to chase them.

**Why:** the old screen rendered two separate lists — a pending strip and a
"Still needs to update" card — and the second one offered a Nudge button to
stale responders, which the server answered with a 400. The same person could
also appear in both lists at once.

**How to apply:** any follow-up/chase UI must derive the button from the
"has no response row" rule, not from "hasn't done what I want yet". Show stale
responders in the list (they do still owe an answer) but without a Nudge
affordance.

## Scoped polls authorize on live membership, never on creator identity

A squad- or event-scoped poll grants access through CURRENT squad membership or
event access. Creating the poll is not itself a grant: a creator who has since
left the squad loses access like anyone else.

Ad-hoc polls are the exception — they have no squad/event to check, so creator,
listed participants and the invite link remain the authorization path.

**Why:** a scoped-creator bypass let a departed member keep reading a squad's
availability board indefinitely.

**How to apply:** when adding any new poll route or widening an existing one,
branch on scope first (squad / event / ad-hoc) and only fall back to creator
identity in the ad-hoc branch.

## Organizer edits trim silently — warn before the write

The server trims out-of-grid cells by stable `<day>-<slot>` identity with no
warning. The client mirrors that same identity rule purely to show the cost
(how many selections, how many people) before the PATCH. Keep the two rules in
lockstep: if the server's trim identity ever changes, the pre-save warning
becomes a lie.
