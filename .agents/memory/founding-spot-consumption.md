---
name: Founding-member spot consumption
description: Limited founding-member spot claims across legacy Stripe and RevenueCat IAP, including sold-out race outcomes.
---

# Founding-member spot consumption

A limited pool of discounted "founding member" subscription spots (counter table
+ a per-subscription redemptions ledger) is consumed **only when payment
succeeds**, never at checkout-session creation.

**Rules:**
- Checkout creation only *reads* the counter to decide which price to show
  (`decideCheckoutTier()` is read-only — it does NOT burn a spot). Whoever
  actually pays consumes the spot. Abandoned checkouts therefore can't deplete
  the pool.
- The spot is consumed in the `checkout.session.completed` webhook, gated on
  `session.metadata.tier === 'founding'` (the tier is stamped onto session +
  subscription metadata at checkout creation).
- Redemption is idempotent **per subscription id**: insert ledger row
  `onConflictDoNothing`; only if a new row was inserted, increment the counter —
  all inside one advisory-locked transaction. Stripe re-delivering the event
  can't double-count.
- **If redemption throws, the webhook must rethrow** (return non-2xx) so Stripe
  retries. Because redemption is idempotent, a retry can never double-count, but
  swallowing the error would silently lose a paid spot forever.
- A redemption result must distinguish **newly redeemed**, **already redeemed**
  (a webhook replay), and **sold out**. A boolean cannot tell a prior winner
  from a final-spot loser.
- RevenueCat IAP re-checks the server-owned cohort state immediately before
  selecting a package; failed/unverified checks select standard, never a
  fallback first package. The paywall only shows a founding price when the live
  offering contains that package and the server says it remains available.
- That purchase-time read must be an authoritative `no-store` server response:
  a client cache directive cannot bypass a process-local or shared cache on a
  display-status route. The paywall must use the same uncached source.
- For a rare last-spot race after a StoreKit/Play purchase sheet is already
  open, claim before writing provenance: the winner is founding; a `sold_out`
  buyer keeps paid SquadZ+ access as **standard**, since the store already
  charged the founding SKU but no founding spot is available. Direct RevenueCat
  entitlement sync must not stamp a new founding tier before that webhook claim.

**Why:** user decided abandoned checkouts must not burn scarce founding spots;
the read-at-start / consume-at-payment split + idempotent ledger is what makes
that correct under concurrency and Stripe retries.

**Accepted tradeoff:** a checkout or StoreKit sheet that was opened while a spot
remained can complete after the cohort closes. The winner receives founding
provenance; a loser cannot have the store charge rewritten, so receives standard
provenance and the lower purchase price. The app prevents new stale founding
package selections, but the webhook outcome is the final race backstop.

**Why:** a client-side availability read is necessarily stale by the time a
mobile store confirms payment. Claiming before entitlement writes preserves the
500-member promise without revoking a legitimately paid subscription.

**How to apply:** any future discounted, capped IAP offering must revalidate
before package selection, return an outcome-rich atomic claim, and use that
outcome before persisting price-tier provenance.
