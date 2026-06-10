---
name: Protected video playback on web needs blob-fetch
description: Why AttachmentVideo blob-fetches protected media instead of setting src directly.
---

# Protected video on react-native-web needs blob-fetch

A DOM `<video src={uri}>` cannot attach custom `Authorization`/auth headers to its
request, so media served from the auth-gated `/api/storage/objects/*` route fails
(401/403) when played in a plain `<video>` on web. Images work because `expo-image`
*does* forward `source.headers`, which is why this bug hides — photos render, clips
silently don't.

**Fix (in `components/AttachmentVideo.tsx`):** when `headers` are supplied, `fetch`
the uri with those headers, `URL.createObjectURL(blob)`, and feed the element that
same-origin blob URL (revoke on cleanup). Cross-origin redirects (Supabase signed
URLs) are followed by `fetch`, which correctly drops the Authorization header on the
redirected hop.

**Why it matters:** `AttachmentVideo` is the web video path for BOTH the Vibe Feed
and Moments. The component used to accept a `headers` prop and ignore it, so any
protected clip was unplayable on web while looking wired-up at the call site.

**How to apply:** any new web surface that plays protected `/objects/*` video must
go through `AttachmentVideo` (or replicate the blob-fetch). Native uses expo-video
`source={{uri, headers}}`, which supports headers directly — no blob needed there.
