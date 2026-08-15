---
name: Refetch flicker from object-identity deps
description: Why lists that fetch their own data must key on a primitive request identity, not on an inline prop object
---

A self-fetching child (active-poll lists, and anything shaped like them) must derive a
**primitive request key** from its scope/filter prop and depend on that key in its
fetch `useCallback`/`useEffect` — never on the prop object itself.

**Why:** Squadz screens build props like `scope={{ type: "squad", squadId }}` inline, so
the object is new on every parent render. Squadz screens also re-render on a steady
drumbeat of unrelated refreshes (SSE squad/conversation/activity updates, focus
refetches). With the object in the dep array, each of those re-created the callback,
re-ran the fetch, flipped `loading` true, and the component's `if (loading) return null`
made the whole list vanish and then pop back — read by users as "my polls disappear
every few seconds and come back." Nothing was being deleted and no membership or
access check was involved; the server was answering 200 the entire time.

**How to apply:** When a user reports content that blinks, vanishes-and-returns, or
"reloads by itself" on a rhythm, suspect this before suspecting data loss or authz.
Check the interval against the app's refresh cadences rather than looking for a literal
timer — there usually isn't one. The fix is a computed key string (also used to build
the query) plus that string in the deps. A silent `return null` while loading turns any
stray refetch into a visible flicker, so a component that renders nothing during load
is especially sensitive to this.
