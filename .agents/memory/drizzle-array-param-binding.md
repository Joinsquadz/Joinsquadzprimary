---
name: Drizzle array params in raw sql
description: Binding a JS array into a raw drizzle sql`` template sends a scalar, not a PG array — build ARRAY[...] from individually bound values.
---

Inside a raw ``sql`` `` template, interpolating a JS `string[]` and casting it
(`sql`${col} ?| ${ids}::text[]``) does NOT produce a PostgreSQL array. Drizzle
binds the value as a single parameter and pg sends the first/scalar element, so
Postgres raises `malformed array literal` at runtime with a UUID in the params.

Build the array out of individually bound values instead:

```ts
const arr = sql.join(ids.map((id) => sql`${id}`), sql`, `);
sql`${col} ?| ARRAY[${arr}]::text[]`
```

**Why:** this shape produced a hard 500 on a logged-in home-screen read; the
query looked correct in review because the cast was present, and the failure
only appears when the route actually runs with a non-empty list.

**How to apply:** any raw `sql` fragment using `?|`, `?&`, `= ANY(...)`, or an
`::x[]` cast over a JS array. Guard the empty-list case before the query (an
empty `ARRAY[]` needs its own handling). Route tests that mock the `sql` tag
must mock `sql.join` too, or they pass while production fails.
