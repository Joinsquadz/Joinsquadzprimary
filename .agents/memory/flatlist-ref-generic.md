---
name: FlatList ref generic pins item type
description: Typing a FlatList ref non-generically silently makes renderItem item `any`, breaking type safety.
---

`const ref = useRef<FlatList>(null)` resolves to `FlatList<any>`. Passing that
ref to `<FlatList ref={ref} data={xs} renderItem={...}/>` pins the component's
`ItemT` generic to `any`, so the inline `renderItem` `item` param is `any` — and
any nested callback (e.g. `item.attachments.map((att, i) => …)`) then trips
`TS7006: implicitly any` under noImplicitAny, while direct property access stays
silent (hiding the loss of type safety).

**Fix:** type the ref with the element type — `useRef<FlatList<ChatMessage>>(null)`
(or `FlatList<VaultPhoto>`). Then `data`/`renderItem` infer correctly.

**Why:** the JSX generic is unified from the ref type, not just `data`, so an
`any` ref overrides `data`-based inference.

**How to apply:** any time you convert a ScrollView to a FlatList and keep a
scroll ref, type the ref generically. Symptom is TS7006 only on a `.map` callback
inside renderItem even though the outer item "looks" typed.
