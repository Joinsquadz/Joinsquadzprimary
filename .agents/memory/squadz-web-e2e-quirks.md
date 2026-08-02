---
name: Squadz web E2E testing quirks
description: Browser-tester host drift, Screenshot-tool splash capture, and other recurring false alarms when E2E-testing the Expo web app.
---

**Tester host drift:** The browser testing subagent's nav tool silently drops the `.expo.` label from the dev URL, landing on the stopped marketing artifact host → every "502/waitlist page/login 404" report was wrong-host contamination (10+ occurrences in one campaign). Mandatory protocol: navigate via JS `window.location.href = "<full expo url>"`, then one atomic evaluation `(location.host.indexOf(".expo.") !== -1) + " || " + location.host + " || " + document.body.innerText.slice(0,150)` in the SAME tab (must start with "true"); click UI only, never type paths; on ANY error page evaluate `location.host` before believing the report.

**Screenshot tool vs splash gate:** the Screenshot tool captures ~1s after load, inside the app's intentional 1-second minimum splash window (`minTimeElapsed` gate in `app/_layout.tsx`). Black `#0D0D0D` = splash; white = pre-font-load `return null`. Screenshot captures of the Expo web app are unreliable for UI verification — trust the tester's real browser or DOM evaluation.

**Rate limiter during automation:** heavy scripted flows burn the per-user API cap (429s that look like feature bugs). Dev has `API_RATE_LIMIT_MAX=5000` set in the development environment; prod keeps the default. Login attempts also hit a strict limiter — tell testers to attempt login ONCE, never retry-loop.

**Server-side adjudication beats tester retries:** when a tester report is ambiguous (empty feed, "deletion didn't stick"), check the DB/API directly (raw pg script via `resolveDbConfig`, curl login) before another tester round — several "failures" were correct authz (friends-audience posts invisible to non-friends) or real server bugs the UI report only hinted at.
