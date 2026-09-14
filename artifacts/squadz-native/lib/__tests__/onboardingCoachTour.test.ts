import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("onboarding analytics contract", () => {
  it("uses the exact non-PII login and onboarding events", () => {
    const login = read("app/login.tsx");
    const onboarding = read("app/onboarding.tsx");

    expect(login).toContain('track("onboarding_welcome_viewed")');
    expect(login).toContain('track("onboarding_get_started")');
    expect(onboarding).toContain('"onboarding_squad_step_viewed"');
    expect(onboarding).toContain('"onboarding_invite_step_viewed"');
    expect(onboarding).toContain('track("onboarding_squad_created")');
    expect(onboarding).toContain('track("onboarding_squad_skipped")');
    expect(onboarding).toContain('track("onboarding_invite_copied", { has_onboarding_squad: !!createdSquadId })');
    expect(onboarding).toContain('track("onboarding_invite_shared", { has_onboarding_squad: !!createdSquadId })');
    expect(onboarding).toContain('track(createdSquadId ? "onboarding_completed" : "onboarding_skipped")');
    expect(onboarding).toContain('track("onboarding_invite_fast_path_viewed")');
  });

  it("deduplicates welcome, step, fast-path, and cost-tip views across rerenders", () => {
    const login = read("app/login.tsx");
    const onboarding = read("app/onboarding.tsx");
    const tips = read("context/TipsContext.tsx");

    expect(login).toContain("welcomeTrackedRef.current");
    expect(onboarding).toContain("viewedStepsRef.current.has(step)");
    expect(onboarding).toContain("fastPathTrackedRef.current");
    expect(tips).toContain("trackedStepsRef.current.has(step)");
    expect(tips).toContain("eventCostViewTrackedRef.current");
    expect(tips).toContain("eventCostDismissTrackedRef.current");
  });

  it("does not include invite or identity values in analytics properties", () => {
    const trackedLines = `${read("app/login.tsx")}\n${read("app/onboarding.tsx")}\n${read("context/TipsContext.tsx")}`
      .split("\n")
      .filter((line) => line.includes("track("))
      .join("\n");

    expect(trackedLines).not.toMatch(/squadName|inviteCode|inviteLink|friendCode|currentUser|firstName/);
  });
});

describe("seven-step coach tour", () => {
  it("uses the canonical order and independent Trip/Vault anchors", () => {
    const tips = read("context/TipsContext.tsx");
    const steps = [...tips.matchAll(/step: "([^"]+)"/g)].map((match) => match[1]);
    const targets = [...tips.matchAll(/target: "([^"]+)"/g)].map((match) => match[1]);

    expect(steps).toEqual([
      "event",
      "trip",
      "availability",
      "chat",
      "moments",
      "vibe_feed",
      "vault",
    ]);
    expect(targets).toEqual(["events", "plans", "poll", "chat", "vault"]);
  });

  it("returns from Feed to the preserved squad for Vault", () => {
    const tips = read("context/TipsContext.tsx");
    expect(tips).toContain('router.replace("/(tabs)/feed" as never)');
    expect(tips).toContain('pathname: "/squad/[id]", params: { id: squadId }');
  });

  it("keeps the per-user seen keys and independent squad anchors", () => {
    const tips = read("context/TipsContext.tsx");
    const squad = read("app/squad/[id].tsx");

    expect(tips).toContain("`tips_seen_${userId}`");
    expect(tips).toContain("`tip_eventcost_seen_${userId}`");
    expect(squad).toContain("ref={plansAnchorRef}");
    expect(squad).toContain("ref={vaultAnchorRef}");
  });
});