import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { profileVaultUpgradeTrigger } from "@/lib/profileVault";

const nativeRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("Photo Vault IA safeguards", () => {
  it("keeps My Photo Vault visible and sends free members to its paywall context", () => {
    expect(profileVaultUpgradeTrigger(false)).toBe("personal_vault");
    expect(profileVaultUpgradeTrigger(true)).toBeNull();
    expect(profileVaultUpgradeTrigger(null)).toBeNull();

    const profileSource = readFileSync(join(nativeRoot, "app", "profile.tsx"), "utf8");
    expect(profileSource).toContain('label: isPro === false ? "My Photo Vault ⚡" : "My Photo Vault"');
    expect(profileSource).toContain("profileVaultUpgradeTrigger(isPro)");
  });

  it("does not allow hardcoded user-facing annual prices outside UpgradeModal fallbacks", () => {
    const violations = sourceFiles(nativeRoot)
      .filter((path) => !path.endsWith(join("components", "UpgradeModal.tsx")))
      .filter((path) => /\$(?:29\.99|19\.99)\/year/.test(readFileSync(path, "utf8")));

    expect(violations).toEqual([]);
  });
});