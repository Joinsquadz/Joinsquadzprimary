---
name: Invite preview security
description: Public plan-preview privacy and compatibility rules for canonical invite links.
---

New plan invite codes must be server-generated with high cryptographic entropy. The public preview may reveal only whether the destination is an event or trip.

Legacy short codes must return a neutral no-content preview without a database lookup, while remaining valid for the authenticated join endpoint.

**Why:** Short codes are enumerable. Returning plan identity, time, location, host, or attendance from a public lookup exposes private event details. Returning 404 for every short code also breaks valid old links because the native client treats 404 as terminal.

**How to apply:** Keep public previews restricted to high-entropy codes and plan type only. Any richer preview requires authenticated authorization. Preserve legacy acceptance through the authenticated join flow.