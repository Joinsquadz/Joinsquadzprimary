---
name: Web clipboard in the preview iframe
description: Why navigator.clipboard fails in the Replit preview and how to copy reliably on web
---

In the cross-origin Replit preview iframe, `navigator.clipboard.writeText`
(what `expo-clipboard` calls on web) is **blocked** by permissions policy — the
copy silently fails and the button "does nothing". This is the same class of
limitation as native `Share.share()` being unavailable in the iframe.

**Rule:** for any web copy-to-clipboard, try a synchronous hidden-`<textarea>` +
`document.execCommand("copy")` path FIRST, while still inside the tap gesture,
then fall back to `navigator.clipboard.writeText`, then to a visible
selectable-text fallback. Native uses `expo-clipboard`.

**Why:** execCommand still works inside the framed preview under a user gesture;
`navigator.clipboard` does not. Doing the async clipboard call first can also
consume the user-gesture context and make the execCommand fallback fail too —
so order matters (sync execCommand before any await).

**How to apply:** squadz-native's Home invite reveal uses a module-scope
`webCopy(text)` helper guarded by `Platform.OS === "web"`. Always keep the
invite/link text visible + `selectable` in the UI so the user is never stuck
even when both copy paths fail.
