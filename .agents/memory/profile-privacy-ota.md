---
name: Profile privacy and OTA release
description: Privacy contract for extended profile fields and safe sequencing for Expo production updates.
---

Private profiles are visible only to the owner, accepted friends, or people who currently share a squad. Other-user responses may expose a computed age but never the raw birthdate.

**Why:** Birthdate is more sensitive than the display information derived from it, and private-profile access must follow actual social relationships rather than mere authentication.

**How to apply:** Gate profile data before returning any profile fields. Compute age server-side. Keep birthdate available only through the owner preferences endpoint.

Profile-field releases that add API or schema support are not safe as OTA-only releases. Publish the backend/schema first, then publish the Expo update with the production API URL explicitly set to `https://joinsquadz.com`.

**Why:** An older API silently ignores new profile keys, and a prior production-channel update embedded the Replit development API domain.

**How to apply:** Confirm the production channel maps to the production branch, verify the generated Expo config resolves the production API URL, publish the Replit backend, then run the EAS update from the native artifact directory.