---
name: Founding-member spot consumption
description: When/how a limited "founding member" discounted-pricing spot is consumed in the Stripe flow, and why it's payment-time + idempotent.
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

**Why:** user decided abandoned checkouts must not burn scarce founding spots;
the read-at-start / consume-at-payment split + idempotent ledger is what makes
that correct under concurrency and Stripe retries.

**Accepted tradeoff:** at the last spot, concurrent shoppers can all be *offered*
the founding price (read-only decision); only the first to pay gets it, the rest
fall to standard. This "offer overshoot" is intentional, not a bug.
