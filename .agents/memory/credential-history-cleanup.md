---
name: Credential history cleanup
description: Why credential removal must cover renamed paths and every reachable Git ref before publishing a repository
---

When removing an accidentally committed credential, inspect historical paths and rewrite every affected ref, not only the current branch or current path. Confirm by searching objects reachable from all refs and checking that the offending commit is no longer reachable.

**Why:** A prior deletion commit had already removed the service-account file from the working tree, but its private key remained in earlier history at both the repository root and the native app path. GitHub push protection still blocked the first push.

**How to apply:** Before pushing a previously private repository, enumerate past credential paths, rewrite all reachable history to exclude them, verify no matching objects remain, and rotate the leaked key separately. Avoid partial ref rewrites that leave old commits reachable.