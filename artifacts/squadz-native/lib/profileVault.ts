import type { UpgradeTrigger } from "@/components/UpgradeModal";

export function profileVaultUpgradeTrigger(isPro: boolean | null): UpgradeTrigger | null {
  return isPro === false ? "personal_vault" : null;
}