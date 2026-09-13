---
name: Protected video playback on web uses signed streaming URLs
description: How protected web video keeps object ACLs while supporting HTTP Range playback.
---

# Protected video on react-native-web needs signed URL resolution

A DOM `<video src={uri}>` cannot attach custom `Authorization`/auth headers to its
request, so media served from the auth-gated `/api/storage/objects/*` route fails
(401/403) when played in a plain `<video>` on web. Images work because `expo-image`
does forward `source.headers`, which is why this bug hides — photos render, clips
silently don't.

**Rule:** when auth headers are supplied, first resolve a protected Supabase object
through the normal auth+ACL route using its `stream=1` mode. Give the returned
short-lived signed URL directly to `<video>` so the storage provider handles HTTP
Range requests. Keep authenticated Blob fetch only as a fallback for legacy object
storage or signed-URL playback failures.

**Why:** fetching the whole protected video into a Blob before rendering delays
startup and can consume hundreds of megabytes of browser memory. Resolving the URL
still runs the exact object ACL before any signed URL is issued.

**How to apply:** any web surface that plays protected `/objects/*` video should go
through `AttachmentVideo`. Native uses expo-video `source={{uri, headers}}`, which
supports headers directly and does not need signed URL resolution.
