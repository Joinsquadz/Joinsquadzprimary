---
name: Vault deletion keeps shared bytes
description: Safe deletion rule when vault media URLs may also be referenced by feed or moment content.
---

Deleting an uploader-owned original vault item removes its photo row and related vault interactions, but does not delete the underlying object or upload provenance.

**Why:** Feed posts, moments, or other media consumers may reuse the same protected object URL. Counting only photo rows before deleting bytes can break still-visible content and also races concurrent references.

**How to apply:** Keep original vault deletion row-scoped unless every media consumer owns an independent copy or a transactional cross-content reference ledger exists. Permanent deletion also requires explicit destructive confirmation.