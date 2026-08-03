---
name: New content-type surface checklist
description: Every place to touch when adding a new user-generated content type (posts, moments, ideas, ...) to Squadz so moderation/reporting/activity don't silently miss it.
---

Adding a new user-generated content type requires ALL of these, or moderation/reporting silently skips it:

1. `lib/db` reports schema — add the type to the `contentType` union.
2. Moderation route — accept the type in the report enum AND teach `maybeAutoHide` how to hide it (ideas use a dedicated `hidden` status; other types differ).
3. `storage.ts` `canUserViewReportedContent` — add a case (SEC-01 gate: reporters must be able to VIEW the content, else 3 coordinated accounts can auto-hide content they've never seen).
4. ActivityTypes in `lib/db` activity schema if the feature emits activity/notifications.
5. Object-storage ACL OR-chain + upload-owner gate if the type carries media (see object-storage-acl-gap.md).
6. Account-deletion purge — new relational rows must be scrubbed in DELETE /account (see account-deletion-purge.md).
7. Hidden content: 404 on per-id reads, excluded from list endpoints — not just filtered client-side.

**Why:** the ideas feature build showed these are scattered and easy to miss; tests only caught the gaps because each surface was checked explicitly.

Test-harness gotcha (api-server): mock update-capture sinks must be exposed as getters (`() => S.updateSets`) because beforeEach reassigns the arrays; and the `@workspace/db` mock factory must export any constants evaluated at router import time (e.g. IDEA_CATEGORIES) or the import crashes before vi.mock applies.
