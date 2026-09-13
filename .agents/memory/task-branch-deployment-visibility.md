---
name: Task-branch deployment visibility
description: Why a completed publish can still serve old code while a project task is in progress.
---

Publishing does not expose changes that still exist only on an in-progress project-task branch. A completed publish can restart the last merged build and therefore keep serving old routes or configuration.

**Why:** Repeated completed publishes served the same old association payload even though the task branch and artifact configuration were correct. Deployment logs showed the old process continuing because the task had not passed completion review and merged.

**How to apply:** For assigned project tasks, validate production behavior locally, complete review and merge, then publish and run deployed-domain smoke checks. Do not repeatedly ask the user to publish an unmerged task branch.