---
name: Report endpoint visibility gate
description: POST /reports pre-checks that the reporter can currently see the content they're reporting, preventing coordinated auto-hide harassment.
---

# Report endpoint visibility gate (SEC-01)

## The rule
`POST /api/reports` (in `routes/moderation.ts`) calls `storage.canUserViewReportedContent(contentType, contentId, reporterId)` before inserting a report row. Returns 403 if the reporter cannot see the content.

## Per-type visibility logic (in `storage.canUserViewReportedContent`)
- **profile** — always true (any authenticated user can view any profile)
- **photo** — delegates to `canUserViewPhotoById(parseInt(contentId), userId)`
- **post** — author always, "friends" audience = friendship check, squad audience = live `isSquadMember`
- **moment** — same as post (same audience model)
- **message** — queries `conversationMessages` by ID for `conversationId`, then `getConversationForMember` (live squad membership check)

## Why this exists
`AUTO_HIDE_THRESHOLD = 3` — three distinct reporters trigger `maybeAutoHide`. Without the visibility gate, three coordinated accounts who know a content UUID (e.g. from prior API access) can hide content they've never legitimately seen.

## Test mock pattern
`moderation.test.ts` mocks `storage.canUserViewReportedContent` as `vi.fn().mockResolvedValue(true)` by default so existing report tests are unaffected. The dedicated test file `moderation.reportVisibility.test.ts` sets `canViewResult.value = false` to exercise the 403 path.
