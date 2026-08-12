---
name: Squadz+ entitlement precedence
description: Why a server "not entitled" must never overwrite a device-confirmed RevenueCat purchase, and why entitlement lives in one global store.
---

Squadz+ entitlement is held in ONE place (AppContext, typed in `lib/entitlement.ts`)
and every reading carries a `source`: `revenuecat` (this device's SDK), `server`
(our API), or `optimistic` (assumed right after a successful purchase).

## The rule

A NEGATIVE reading sourced from `server` must not replace a POSITIVE reading
sourced from `revenuecat` or `optimistic`. Everything else applies normally:
any positive reading wins, and a negative reading from the store wins.

**Why:** the RevenueCat webhook is what flips server state, and it lands seconds
after the purchase completes on device. In that window `/api/subscription`
truthfully answers "not Pro" for someone who just paid — adopting it re-locks the
app underneath them, which is exactly the propagation bug this replaced. The
store is authoritative about the ABSENCE of a purchase (expiry, refund,
restore-found-nothing), so a store-sourced negative is always honoured.

**How to apply:** never call the state setter directly with a raw boolean; route
every reading through `applyEntitlement`. When adding a new surface that learns
about entitlement (a new endpoint, a new SDK callback), give it a `source` rather
than special-casing it.

## Supporting invariants

- `resolved: false` is NOT "free". Gated screens must show a spinner while
  unresolved, or every cold start briefly flashes a paywall at a paying user.
- `POST /api/iap/sync` makes the server read RevenueCat directly, so ONE
  successful call is authoritative and does not depend on webhook delivery. This
  is why post-purchase polling was removed. Its failures must be reported as
  "couldn't tell" (no entitlement in the result), never as "not entitled".
- Tier (`founding` / `standard`) is provenance/display ONLY. Access is decided
  solely by the boolean. An entitled user on an unrecognized product id resolves
  to `standard`, never `none`.
- Exactly one app-wide customer-info listener exists, owned by
  `RevenueCatConnector`, bound to the signed-in user id and torn down on logout.
  Late deliveries check the bound id first — otherwise a previous account's
  listener writes its entitlement into the next account's session.

## Change invalidation: one boundary, not per-screen watchers

Deciding WHAT the entitlement is (`lib/entitlement.ts`) is separate from deciding
what must be re-read WHEN it changes (`lib/entitlementInvalidation.ts`). Screens
subscribe through the context; they must not watch `isPro` themselves.

**Why:** the server computes the free-plan cap, the squad cap, and vault gating,
so those answers are stale the instant entitlement changes — and the change
usually originates on a DIFFERENT screen than the one holding the stale value
(buy from the Photos tab, and the create screen still says "3/3 free plans
used"). A local `isPro` effect only fires while that screen is mounted, so the
staleness survives until app restart. The mirror case is a lapse leaving an
unlocked vault on screen.

**How to apply:** a change is only worth broadcasting when the ACCESS ANSWER
changes — unresolved→resolved, an entitled flip, or a tier change while entitled.
A `source` change alone (server confirming what the store already reported) is
NOT a change; treating it as one turns every foreground into a refetch storm,
because the RC listener, launch reconciliation and every vault response all
publish an entitlement. Any new gated surface joins the boundary by adding a
target rather than inventing its own watcher.

## Debugging trap

Expo/Metro logs can report `ReferenceError: Property 'X' doesn't exist` for a
symbol that no longer exists anywhere in the source, with line numbers that don't
match the file. That is a STALE BUNDLE from a mid-edit save, not a real error —
restart the expo workflow and re-read the logs before investigating.
