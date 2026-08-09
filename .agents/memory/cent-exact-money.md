---
name: Cent-exact money validation
description: How Squadz validates and splits money amounts, and the float trap that makes the obvious whole-cent check wrong.
---

## Rule
A "is this a whole-cent amount?" check must compare against the 2-decimal rendering
(`Number(value.toFixed(2)) === value`), never against `Math.round(value * 100) === value * 100`.

**Why:** binary floating point turns `10.05 * 100` into `1004.9999999999999`, so the
multiply-and-compare form rejects perfectly ordinary prices (10.05, 27.10, 33.33, 47.11).
That bug shipped once and only surfaced through a reconciliation test with real-looking
totals — even-dollar fixtures pass it happily. Always test with prices that have awkward
cents, not 10/20/30.

## Rule
Split reconciliation compares integer cents on both sides (sum of `Math.round(share * 100)`
vs `Math.round(total * 100)`), not a `Math.abs(diff) < 0.01` tolerance. The old tolerance
silently accepted sub-cent drift that could never settle.

**How to apply:** any new expense/cost/money write path (event, trip, squad) must reuse the
same cent-exact validation. Note the check currently exists in two places — the API route
layer and the mobile split helper — so a change to one needs the mirror change in the other.

## Rule
Percentage tips are derived from base + tax and rounded once, to the cent. Client and server
must use the identical formula or the server rejects the client's own grand total.
