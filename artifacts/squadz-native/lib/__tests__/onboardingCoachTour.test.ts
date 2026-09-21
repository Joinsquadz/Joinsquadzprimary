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
    expect(onboarding).toContain('createdSquadId ? "onboarding_completed" : "onboarding_skipped"');
    expect(onboarding).toContain('createdSquadId ? { sent_invite: inviteEngagedRef.current } : undefined');
    expect(onboarding).toContain('track("onboarding_invite_fast_path_viewed")');
  });

  it("tracks invite engagement only for successful copy/share completion", () => {
    const onboarding = read("app/onboarding.tsx");
    const copyStart = onboarding.indexOf("async function handleCopy()");
    const shareStart = onboarding.indexOf("async function handleShare()");
    const completionStart = onboarding.indexOf("const handleComplete = () =>");

    expect(copyStart).toBeGreaterThan(-1);
    expect(shareStart).toBeGreaterThan(copyStart);
    expect(completionStart).toBeGreaterThan(-1);
    expect(onboarding.slice(completionStart, copyStart)).toContain(
      'createdSquadId ? "onboarding_completed" : "onboarding_skipped"',
    );
    expect(onboarding.slice(completionStart, copyStart)).toContain(
      'createdSquadId ? { sent_invite: inviteEngagedRef.current } : undefined',
    );

    const copyBlock = onboarding.slice(copyStart, shareStart);
    expect(copyBlock).toContain("await Clipboard.setStringAsync(inviteLink);");
    expect(copyBlock).toContain("inviteEngagedRef.current = true;");
    expect(copyBlock).toContain('track("onboarding_invite_copied", { has_onboarding_squad: !!createdSquadId })');

    const shareBlock = onboarding.slice(shareStart);
    expect(shareBlock).toContain("if (result.action === Share.sharedAction)");
    expect(shareBlock).toContain("inviteEngagedRef.current = true;");
    expect(shareBlock).toContain('track("onboarding_invite_shared", { has_onboarding_squad: !!createdSquadId })');
    expect(shareBlock).toContain("handleComplete();");
  });

  it("deduplicates welcome, step, and fast-path views across rerenders", () => {
    const login = read("app/login.tsx");
    const onboarding = read("app/onboarding.tsx");
    const tips = read("context/TipsContext.tsx");

    expect(login).toContain("welcomeTrackedRef.current");
    expect(onboarding).toContain("viewedStepsRef.current.has(step)");
    expect(onboarding).toContain("fastPathTrackedRef.current");
    expect(tips).toContain("trackedStepsRef.current.has(step)");
    expect(tips).not.toContain("eventCost");
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

  it("keeps the tour seen key and independent squad anchors", () => {
    const tips = read("context/TipsContext.tsx");
    const squad = read("app/squad/[id].tsx");

    expect(tips).toContain("`tips_seen_${userId}`");
    expect(tips).not.toContain("tip_eventcost_seen");
    expect(squad).toContain("ref={plansAnchorRef}");
    expect(squad).toContain("ref={vaultAnchorRef}");
  });
});