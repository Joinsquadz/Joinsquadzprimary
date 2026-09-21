---
name: Android release manifest verification
description: How to verify permissions in the actual packaged Android release when the Replit container lacks an Android SDK.
---

# Verify the packaged release manifest from EAS

Local Expo prebuild can generate the Android project, but the Replit container may have Java without an Android SDK, so Gradle release builds stop at “SDK location not found.”

**Why:** Expo introspection is not sufficient for permission audits because Gradle dependencies can add permissions during manifest merging. A real release AAB is the authoritative result.

**How to apply:** Build with the production EAS profile without submitting, download that AAB, and use bundletool’s `dump manifest` on its base module. Compare against the preceding production AAB when a true packaged before/after list is required. Remember that EAS production builds auto-increment the remote Android build number.