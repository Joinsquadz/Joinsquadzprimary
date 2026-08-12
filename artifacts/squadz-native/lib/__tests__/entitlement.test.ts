/**
 * Precedence rules for the global Squadz+ entitlement store (lib/entitlement.ts).
 *
 * This is the crux of the propagation bug: a purchase is confirmed on-device by
 * RevenueCat several seconds before the webhook reaches our server, so any
 * `/api/subscription` read that lands in that window truthfully reports "not
 * Pro". Adopting it would re-lock the app under a user who just paid.
 */
import { describe, it, expect } from "vitest";

import {
  UNRESOLVED_ENTITLEMENT,
  applyEntitlement,
  type Entitlement,
  type ResolvedEntitlement,
} from "@/lib/entitlement";

const serverPro: ResolvedEntitlement = {
  resolved: true,
  entitled: true,
  tier: "standard",
  source: "server",
};
const serverFree: ResolvedEntitlement = {
  resolved: true,
  entitled: false,
  tier: "none",
  source: "server",
};
const rcPro: ResolvedEntitlement = {
  resolved: true,
  entitled: true,
  tier: "founding",
  source: "revenuecat",
};
const rcFree: ResolvedEntitlement = {
  resolved: true,
  entitled: false,
  tier: "none",
  source: "revenuecat",
};
const optimisticPro: ResolvedEntitlement = {
  resolved: true,
  entitled: true,
  tier: "founding",
  source: "optimistic",
};

describe("applyEntitlement — first reading", () => {
  it("adopts any reading over the unresolved initial state", () => {
    expect(applyEntitlement(UNRESOLVED_ENTITLEMENT, serverFree)).toEqual(serverFree);
    expect(applyEntitlement(UNRESOLVED_ENTITLEMENT, rcPro)).toEqual(rcPro);
  });
});

describe("applyEntitlement — the post-purchase race (the actual bug)", () => {
  it("does NOT let a lagging server 'not entitled' overwrite a store-confirmed purchase", () => {
    const afterPurchase = applyEntitlement(UNRESOLVED_ENTITLEMENT, rcPro);
    // Webhook hasn't landed yet; /api/subscription honestly answers isPro:false.
    const afterLateServerRead = applyEntitlement(afterPurchase, serverFree);
    expect(afterLateServerRead.entitled).toBe(true);
    expect(afterLateServerRead.tier).toBe("founding");
  });

  it("protects an optimistic post-purchase reading the same way", () => {
    const result = applyEntitlement(optimisticPro, serverFree);
    expect(result.entitled).toBe(true);
  });

  it("adopts the server once it CONFIRMS the entitlement (tier becomes authoritative)", () => {
    const result = applyEntitlement(optimisticPro, serverPro);
    expect(result).toEqual(serverPro);
  });
});

describe("applyEntitlement — genuine downgrades still apply", () => {
  it("accepts a store-sourced 'not entitled' (expiry / refund / nothing to restore)", () => {
    // The store is authoritative about the ABSENCE of a purchase, unlike the server.
    expect(applyEntitlement(rcPro, rcFree)).toEqual(rcFree);
    expect(applyEntitlement(optimisticPro, rcFree)).toEqual(rcFree);
  });

  it("accepts a server 'not entitled' when the current reading also came from the server", () => {
    // No local purchase is pending here, so there is nothing to protect.
    expect(applyEntitlement(serverPro, serverFree)).toEqual(serverFree);
  });

  it("accepts a server 'not entitled' when the user was already not entitled", () => {
    expect(applyEntitlement(rcFree, serverFree)).toEqual(serverFree);
  });
});

describe("applyEntitlement — upgrades always win", () => {
  it("adopts a positive reading from any source over a negative one", () => {
    const fromServer: Entitlement = serverFree;
    expect(applyEntitlement(fromServer, rcPro)).toEqual(rcPro);
    expect(applyEntitlement(fromServer, serverPro)).toEqual(serverPro);
    // e.g. a renewal or Ask-to-Buy approval delivered via the RC listener.
    expect(applyEntitlement(rcFree, rcPro)).toEqual(rcPro);
  });
});

describe("unresolved is not 'free'", () => {
  it("starts unresolved so gated screens can show a spinner instead of a paywall", () => {
    expect(UNRESOLVED_ENTITLEMENT.resolved).toBe(false);
    expect(UNRESOLVED_ENTITLEMENT.entitled).toBe(false);
  });
});
