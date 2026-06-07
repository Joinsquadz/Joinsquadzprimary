import { Linking, Platform } from "react-native";
import type { Cost } from "@/data/mock";

export type SettleLine = {
  userId: string;
  /** Positive: this person owes the current user. Negative: the current user owes this person. */
  net: number;
};

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
