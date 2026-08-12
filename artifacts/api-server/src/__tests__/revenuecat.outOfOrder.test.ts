/**
 * Audit #640 — RevenueCat webhook delivery is neither ordered nor
 * exactly-once, so entitlement decisions must be based on the state the event
 * describes, not merely on its type.
 *
 * The failure this guards against: a user's subscription expires, then they
 * immediately resubscribe (or the subscription is extended/renewed). If the
 * delayed EXPIRATION for the OLD period is delivered after the RENEWAL — a
 * normal occurrence with retries — a type-only rule revokes Squadz+ from a
 * subscriber who is currently paid up. They silently lose Pro until the next
 * renewal event or a manual /iap/sync.
 *
 * The rule: an EXPIRATION that carries an expiration timestamp still in the
 * FUTURE has been superseded and must be ignored. An EXPIRATION with no
 * timestamp (or a past one) is authoritative and revokes.
 */
import { describe, it, expect } from "vitest";
import { decideEntitlement, type RevenueCatEvent } from "../lib/revenuecat";

const STANDARD = "squadz_plus_standard_yearly";
const NOW = Date.UTC(2026, 0, 1);
const HOUR = 60 * 60 * 1000;

const event = (over: Partial<RevenueCatEvent>): RevenueCatEvent => ({
  type: "EXPIRATION",
  app_user_id: "u1",
  product_id: STANDARD,
  entitlement_ids: ["squadz_plus"],
  ...over,
});

describe("decideEntitlement — out-of-order webhook delivery", () => {
  it("ignores a stale EXPIRATION whose expiry is still in the future", () => {
    // Delivered late, after the user already renewed: the period it describes
    // has not actually ended.
    const decision = decideEntitlement(
      event({ type: "EXPIRATION", expiration_at_ms: NOW + 30 * 24 * HOUR }),
      NOW,
    );
    expect(decision).toBe("ignore");
  });

  it("revokes on an EXPIRATION whose expiry has genuinely passed", () => {
    const decision = decideEntitlement(
      event({ type: "EXPIRATION", expiration_at_ms: NOW - HOUR }),
      NOW,
    );
    expect(decision).toBe("revoke");
  });

  it("revokes on an EXPIRATION with no timestamp (nothing to compare, treat as authoritative)", () => {
    const decision = decideEntitlement(event({ type: "EXPIRATION" }), NOW);
    expect(decision).toBe("revoke");
  });

  it("still revokes a late grant event whose period already lapsed", () => {
    // The mirror case, which already worked: a RENEWAL delivered so late that
    // its own period is over must not re-grant.
    const decision = decideEntitlement(
      event({ type: "RENEWAL", expiration_at_ms: NOW - HOUR }),
      NOW,
    );
    expect(decision).toBe("revoke");
  });

  it("grants on a RENEWAL whose period is still active", () => {
    const decision = decideEntitlement(
      event({ type: "RENEWAL", expiration_at_ms: NOW + 30 * 24 * HOUR }),
      NOW,
    );
    expect(decision).toBe("grant");
  });

  it("ignores events that do not target Squadz+ at all", () => {
    const decision = decideEntitlement(
      { type: "EXPIRATION", app_user_id: "u1", product_id: "some_other_product" },
      NOW,
    );
    expect(decision).toBe("ignore");
  });
});
