import { Linking, Platform } from "react-native";
import type { Cost } from "@/types";

export type SettleLine = {
  userId: string;
  /** Positive: this person owes the current user. Negative: the current user owes this person. */
  net: number;
};

export type PaymentStatus = "unpaid" | "paid" | "confirmed";

/** One owed share, tied to the specific cost it came from (so it can be settled individually). */
export type SettleShare = {
  costId: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  paidAt: string | null;
  confirmedAt: string | null;
};

/** All of one person's owed shares to/from the current user, grouped under that person. */
export type SettleGroup = {
  /** The other party: the requester (when you owe) or the debtor (when owed to you). */
  userId: string;
  /** Sum of every share in this group (paid or not). */
  total: number;
  /** Sum of shares not yet confirmed by the payer. */
  outstanding: number;
  shares: SettleShare[];
};

function shareStatus(sh: { paidAt?: string | null; confirmedAt?: string | null }): PaymentStatus {
  if (sh.confirmedAt) return "confirmed";
  if (sh.paidAt) return "paid";
  return "unpaid";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildGroups(
  rows: Array<{ otherId: string; share: SettleShare }>,
): SettleGroup[] {
  const byUser = new Map<string, SettleShare[]>();
  for (const { otherId, share } of rows) {
    const list = byUser.get(otherId) ?? [];
    list.push(share);
    byUser.set(otherId, list);
  }
  return [...byUser.entries()]
    .map(([userId, shares]) => ({
      userId,
      total: round(shares.reduce((s, x) => s + x.amount, 0)),
      outstanding: round(
        shares.filter((x) => x.status !== "confirmed").reduce((s, x) => s + x.amount, 0),
      ),
      shares: shares.sort((a, b) => a.description.localeCompare(b.description)),
    }))
    .sort((a, b) => b.outstanding - a.outstanding || b.total - a.total);
}

/** What the current user owes, grouped by the requester (the person who paid). */
export function computeOwed(costs: Cost[], meId: string): SettleGroup[] {
  const rows: Array<{ otherId: string; share: SettleShare }> = [];
  for (const c of costs) {
    if (c.paidById === meId) continue;
    for (const sh of c.shares) {
      if (sh.userId !== meId || sh.amount <= 0) continue;
      rows.push({
        otherId: c.paidById,
        share: {
          costId: c.id,
          description: c.description,
          amount: round(sh.amount),
          status: shareStatus(sh),
          paidAt: sh.paidAt ?? null,
          confirmedAt: sh.confirmedAt ?? null,
        },
      });
    }
  }
  return buildGroups(rows);
}

/** What others owe the current user, grouped by the debtor. Only costs the user paid for. */
export function computeOwedToMe(costs: Cost[], meId: string): SettleGroup[] {
  const rows: Array<{ otherId: string; share: SettleShare }> = [];
  for (const c of costs) {
    if (c.paidById !== meId) continue;
    for (const sh of c.shares) {
      if (sh.userId === meId || sh.amount <= 0) continue;
      rows.push({
        otherId: sh.userId,
        share: {
          costId: c.id,
          description: c.description,
          amount: round(sh.amount),
          status: shareStatus(sh),
          paidAt: sh.paidAt ?? null,
          confirmedAt: sh.confirmedAt ?? null,
        },
      });
    }
  }
  return buildGroups(rows);
}

/**
 * Compute net balances between the current user and everyone else, from the
 * event's recorded costs. Only pairwise balances involving `meId` are returned,
 * which is all that's needed to drive the "settle up" UI.
 */
export function computeSettle(costs: Cost[], meId: string): SettleLine[] {
  const byUser = new Map<string, number>();
  for (const c of costs) {
    const payer = c.paidById;
    for (const sh of c.shares) {
      if (sh.userId === payer) continue;
      if (payer === meId) {
        byUser.set(sh.userId, (byUser.get(sh.userId) ?? 0) + sh.amount);
      } else if (sh.userId === meId) {
        byUser.set(payer, (byUser.get(payer) ?? 0) - sh.amount);
      }
    }
  }
  return [...byUser.entries()]
    .map(([userId, net]) => ({ userId, net: Math.round(net * 100) / 100 }))
    .filter((l) => Math.abs(l.net) >= 0.01)
    .sort((a, b) => a.net - b.net);
}

function venmoUrls(amount: number, note: string): { app: string; web: string } {
  const amt = amount.toFixed(2);
  const n = encodeURIComponent(note);
  return {
    app: `venmo://paycharge?txn=pay&amount=${amt}&note=${n}`,
    web: `https://account.venmo.com/pay?txn=pay&amount=${amt}&note=${n}`,
  };
}

function cashAppUrls(amount: number): { app: string; web: string } {
  const amt = Math.round(amount * 100) / 100;
  return {
    app: `https://cash.app/launch/payment?amount=${amt}`,
    web: `https://cash.app/`,
  };
}

async function open({ app, web }: { app: string; web: string }): Promise<void> {
  if (Platform.OS === "web") {
    await Linking.openURL(web);
    return;
  }
  try {
    const canOpen = await Linking.canOpenURL(app);
    await Linking.openURL(canOpen ? app : web);
  } catch {
    await Linking.openURL(web);
  }
}

/** Open Venmo (app if installed, else web) prefilled with the amount + note. */
export function payWithVenmo(amount: number, note: string): Promise<void> {
  return open(venmoUrls(amount, note));
}

/** Open Cash App (app if installed, else web). */
export function payWithCashApp(amount: number): Promise<void> {
  return open(cashAppUrls(amount));
}

function cashAppUrlsForHandle(handle: string, amount: number): { app: string; web: string } {
  const tag = handle.replace(/^\$+/, "");
  const amt = Math.round(amount * 100) / 100;
  const web = `https://cash.app/$${tag}/${amt}`;
  return { app: web, web };
}

function venmoUrlsForHandle(handle: string, amount: number, note: string): { app: string; web: string } {
  const user = encodeURIComponent(handle.replace(/^@+/, ""));
  const amt = amount.toFixed(2);
  const n = encodeURIComponent(note);
  return {
    app: `venmo://paycharge?txn=pay&recipients=${user}&amount=${amt}&note=${n}`,
    web: `https://account.venmo.com/u/${user}`,
  };
}

/** Open Venmo prefilled to pay a specific @handle, app if installed else their profile. */
export function payWithVenmoHandle(handle: string, amount: number, note: string): Promise<void> {
  return open(venmoUrlsForHandle(handle, amount, note));
}

/** Open Cash App to a specific $cashtag with the amount prefilled. */
export function payWithCashAppHandle(handle: string, amount: number): Promise<void> {
  return open(cashAppUrlsForHandle(handle, amount));
}

/**
 * Zelle has no public deep-link/URL scheme, so we can't prefill a payment.
 * Surface the recipient's Zelle handle (email/phone) for the user to copy into
 * their banking app. Returns the handle so the caller can show a copy affordance.
 */
export function zelleInstructions(handle: string): string {
  return handle;
}
